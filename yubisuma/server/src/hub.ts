// 接続・プロフィール・ルーム・マッチメイキングをまとめる中枢。WebSocket には依存しない（テスト容易性のため）。

import { randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { displayRating, initialRating, tierName, update, type Rating } from "./glicko2.ts";
import { Room, sanitizeChant, sanitizeSettings, defaultSettings, type RoomDeps, type RoomMode, type RoomSettings } from "./room.ts";

export interface Connection {
  send(msg: object): void;
  close(): void;
}

interface Profile {
  id: string;
  token: string;
  name: string;
  chant?: string;
  ranked: Rating;
  rankedGames: number;
  rankedWins: number;
  casualGames: number;
}

type QueueMode = "casual" | "ranked";

interface QueueEntry {
  playerId: string;
  joinedAt: number;
}

export interface HubOptions {
  dataFile?: string | null;
  now?: () => number;
  casualCpuFillMs?: number;
  roomDeps?: Pick<RoomDeps, "timings" | "rng">;
  /** 開発・テスト用：全ルームの設定を上書き（入力時間の短縮など） */
  forceSettings?: Partial<RoomSettings>;
}

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export class Hub {
  private profiles = new Map<string, Profile>(); // token -> profile
  private byId = new Map<string, Profile>();
  private conns = new Map<string, Connection>(); // playerId -> 接続
  private roomOf = new Map<string, Room>(); // playerId -> ルーム
  private rooms = new Map<string, Room>();
  private queues: Record<QueueMode, QueueEntry[]> = { casual: [], ranked: [] };
  private opts: Required<Omit<HubOptions, "roomDeps" | "forceSettings">> & Pick<HubOptions, "roomDeps" | "forceSettings">;
  private saveTimer: NodeJS.Timeout | null = null;

  constructor(opts: HubOptions = {}) {
    this.opts = {
      dataFile: opts.dataFile ?? null,
      now: opts.now ?? Date.now,
      casualCpuFillMs: opts.casualCpuFillMs ?? 20000,
      roomDeps: opts.roomDeps,
      forceSettings: opts.forceSettings,
    };
    this.load();
  }

  // ───────── 接続 ─────────

  /** メッセージを処理する。戻り値は（hello 後の）プレイヤー ID */
  handle(conn: Connection, playerId: string | null, raw: unknown): string | null {
    const msg = raw as Record<string, unknown>;
    if (!msg || typeof msg !== "object" || typeof msg.type !== "string") return playerId;
    try {
      if (msg.type === "hello") return this.hello(conn, msg);
      if (!playerId) throw new Error("hello を先に送ってください");
      this.dispatch(playerId, msg);
    } catch (e) {
      conn.send({ type: "error", message: (e as Error).message });
    }
    return playerId;
  }

  disconnected(conn: Connection, playerId: string | null): void {
    if (!playerId || this.conns.get(playerId) !== conn) return;
    this.conns.delete(playerId);
    this.leaveQueue(playerId);
    const room = this.roomOf.get(playerId);
    if (room?.inMatch) room.disconnect(playerId);
    else this.leaveRoom(playerId);
  }

  private hello(conn: Connection, msg: Record<string, unknown>): string {
    const name = sanitizeName(msg.name);
    let profile = typeof msg.token === "string" ? this.profiles.get(msg.token) : undefined;
    if (!profile) {
      profile = {
        id: randomUUID(),
        token: randomBytes(24).toString("base64url"),
        name,
        ranked: initialRating(),
        rankedGames: 0,
        rankedWins: 0,
        casualGames: 0,
      };
      this.profiles.set(profile.token, profile);
      this.byId.set(profile.id, profile);
    }
    profile.name = name;
    if (msg.chant !== undefined) profile.chant = sanitizeChant(msg.chant);
    this.scheduleSave();

    const old = this.conns.get(profile.id);
    if (old && old !== conn) {
      old.send({ type: "kicked", message: "同じプレイヤーが別の場所から接続したため切断しました" });
      old.close();
    }
    this.conns.set(profile.id, conn);
    conn.send({ type: "welcome", playerId: profile.id, token: profile.token, profile: this.publicProfile(profile) });

    const room = this.roomOf.get(profile.id);
    if (room?.reconnect(profile.id)) room.sendState(profile.id, "state");
    else this.roomOf.delete(profile.id);
    return profile.id;
  }

  private dispatch(id: string, msg: Record<string, unknown>) {
    const room = this.roomOf.get(id);
    switch (msg.type) {
      case "profile.update": {
        const p = this.byId.get(id)!;
        p.chant = sanitizeChant(msg.chant);
        this.scheduleSave();
        room?.setChant(id, p.chant);
        return this.send(id, { type: "profile", profile: this.publicProfile(p) });
      }
      case "profile.get":
        return this.send(id, { type: "profile", profile: this.publicProfile(this.byId.get(id)!) });
      case "practice.start": {
        const cpus = clampInt(msg.cpus, 1, 3, 1);
        const level = msg.level === 1 ? 1 : 2;
        const r = this.createRoom("practice", { ...defaultSettings("practice"), maxPlayers: cpus + 1 });
        this.joinRoom(id, r);
        for (let i = 0; i < cpus; i++) r.addCpu(level);
        return r.start(id);
      }
      case "queue.join":
        return this.joinQueue(id, msg.mode === "ranked" ? "ranked" : "casual");
      case "queue.leave":
        this.leaveQueue(id);
        return this.send(id, { type: "queue.left" });
      case "room.create": {
        const r = this.createRoom("private", sanitizeSettings((msg.settings ?? {}) as Partial<RoomSettings>, defaultSettings("private")));
        return this.joinRoom(id, r);
      }
      case "room.join": {
        const code = String(msg.code ?? "").toUpperCase().trim();
        const r = this.rooms.get(code);
        if (!r || r.mode !== "private") throw new Error("ルームが見つかりません");
        return this.joinRoom(id, r);
      }
      case "room.leave":
        return this.leaveRoom(id);
      case "room.start":
        if (!room || (room.mode !== "private" && room.mode !== "practice")) throw new Error("開始できません");
        return room.start(id);
      case "room.addCpu":
        if (!room || room.mode !== "private" || room.hostId !== id) throw new Error("ホストのみ追加できます");
        return room.addCpu(msg.level === 1 ? 1 : 2);
      case "room.removeCpu":
        if (!room || room.mode !== "private" || room.hostId !== id) throw new Error("ホストのみ操作できます");
        return room.removeCpu(String(msg.id));
      case "room.settings":
        if (!room) throw new Error("ルームに入っていません");
        return room.updateSettings(id, (msg.settings ?? {}) as Partial<RoomSettings>);
      case "input.thumbs":
        room?.applyInput(id, { kind: "thumbs", roundId: Number(msg.roundId), up: Number(msg.up) });
        return;
      case "input.call":
        room?.applyInput(id, { kind: "call", roundId: Number(msg.roundId), number: Number(msg.number) });
        return;
      case "input.ready":
        room?.markReady(id, Number(msg.roundId));
        return;
      case "emote":
        room?.emote(id, Number(msg.id));
        return;
      default:
        throw new Error(`不明なメッセージ: ${String(msg.type)}`);
    }
  }

  private send(id: string, msg: object) {
    this.conns.get(id)?.send(msg);
  }

  // ───────── ルーム ─────────

  private createRoom(mode: RoomMode, settings?: RoomSettings): Room {
    let code: string;
    do {
      code = Array.from(randomBytes(6), (b) => CODE_CHARS[b % CODE_CHARS.length]).join("");
    } while (this.rooms.has(code));
    const room = new Room(
      code,
      mode,
      {
        ...this.opts.roomDeps,
        send: (pid, m) => this.send(pid, m),
        onMatchEnd: (r, info) => this.onMatchEnd(r, info.placements),
        onEmpty: (r) => this.destroyRoom(r),
      },
      settings && { ...settings, ...this.opts.forceSettings },
    );
    if (!settings) room.settings = { ...room.settings, ...this.opts.forceSettings };
    this.rooms.set(code, room);
    return room;
  }

  private joinRoom(id: string, room: Room) {
    if (this.roomOf.get(id) === room) return room.sendState(id, "room.update");
    this.leaveQueue(id);
    this.leaveRoom(id);
    const p = this.byId.get(id)!;
    room.addMember(id, p.name, p.chant);
    this.roomOf.set(id, room);
  }

  private leaveRoom(id: string) {
    const room = this.roomOf.get(id);
    if (!room) return;
    this.roomOf.delete(id);
    room.leave(id);
    this.send(id, { type: "room.left" });
    if (room.humans().filter((h) => this.roomOf.get(h.id) === room).length === 0) this.destroyRoom(room);
  }

  private destroyRoom(room: Room) {
    room.dispose();
    this.rooms.delete(room.code);
    for (const m of room.humans()) if (this.roomOf.get(m.id) === room) this.roomOf.delete(m.id);
  }

  private onMatchEnd(room: Room, placements: string[]): object | void {
    if (room.mode === "casual") {
      for (const m of room.humans()) {
        const p = this.byId.get(m.id);
        if (p) p.casualGames += 1;
      }
      this.scheduleSave();
      return;
    }
    if (room.mode !== "ranked" || placements.length !== 2) return;
    const [winner, loser] = placements.map((pid) => this.byId.get(pid));
    if (!winner || !loser) return;
    const before = { w: winner.ranked, l: loser.ranked };
    winner.ranked = update(before.w, before.l, 1);
    loser.ranked = update(before.l, before.w, 0);
    winner.rankedGames += 1;
    winner.rankedWins += 1;
    loser.rankedGames += 1;
    this.scheduleSave();
    const entry = (p: Profile, prev: Rating) => ({
      before: displayRating(prev),
      after: displayRating(p.ranked),
      delta: displayRating(p.ranked) - displayRating(prev),
      tier: tierName(displayRating(p.ranked), p.rankedGames),
    });
    return { ratings: { [winner.id]: entry(winner, before.w), [loser.id]: entry(loser, before.l) } };
  }

  // ───────── マッチメイキング ─────────

  private joinQueue(id: string, mode: QueueMode) {
    this.leaveRoom(id);
    this.leaveQueue(id);
    this.queues[mode].push({ playerId: id, joinedAt: this.opts.now() });
    this.send(id, { type: "queue.status", mode, waitedSec: 0, waiting: this.queues[mode].length });
  }

  private leaveQueue(id: string) {
    for (const mode of ["casual", "ranked"] as const) {
      this.queues[mode] = this.queues[mode].filter((e) => e.playerId !== id);
    }
  }

  /** 1 秒ごとに呼ぶ */
  tick(): void {
    const now = this.opts.now();
    this.matchCasual(now);
    this.matchRanked(now);
    for (const mode of ["casual", "ranked"] as const) {
      for (const e of this.queues[mode]) {
        this.send(e.playerId, {
          type: "queue.status",
          mode,
          waitedSec: Math.floor((now - e.joinedAt) / 1000),
          waiting: this.queues[mode].length,
        });
      }
    }
  }

  private matchCasual(now: number) {
    const q = this.queues.casual;
    while (q.length >= 4) this.launch("casual", q.splice(0, 4), 0);
    if (q.length > 0 && now - q[0].joinedAt >= this.opts.casualCpuFillMs) {
      const n = q.length;
      this.launch("casual", q.splice(0, n), 4 - n);
    }
  }

  private matchRanked(now: number): void {
    const q = this.queues.ranked;
    const rating = (e: QueueEntry) => this.byId.get(e.playerId)!.ranked.rating;
    const window = (e: QueueEntry) => {
      const waited = (now - e.joinedAt) / 1000;
      return waited >= 60 ? Infinity : Math.min(400, 50 + 25 * Math.floor(waited / 5));
    };
    for (let i = 0; i < q.length; i++) {
      let best = -1;
      let bestDiff = Infinity;
      for (let j = 0; j < q.length; j++) {
        if (i === j) continue;
        const diff = Math.abs(rating(q[i]) - rating(q[j]));
        if (diff <= Math.min(window(q[i]), window(q[j])) && diff < bestDiff) {
          best = j;
          bestDiff = diff;
        }
      }
      if (best !== -1) {
        const pair = [q[i], q[best]];
        this.queues.ranked = q.filter((e) => !pair.includes(e));
        this.launch("ranked", pair, 0);
        return this.matchRanked(now);
      }
    }
  }

  private launch(mode: QueueMode, entries: QueueEntry[], cpus: number) {
    const room = this.createRoom(mode);
    for (const e of entries) {
      const p = this.byId.get(e.playerId)!;
      room.addMember(e.playerId, p.name, p.chant);
      this.roomOf.set(e.playerId, room);
    }
    for (let i = 0; i < cpus; i++) room.addCpu(2);
    room.start();
  }

  // ───────── プロフィール ─────────

  private publicProfile(p: Profile) {
    const display = displayRating(p.ranked);
    return {
      id: p.id,
      name: p.name,
      chant: sanitizeChant(p.chant),
      rating: display,
      tier: tierName(display, p.rankedGames),
      rankedGames: p.rankedGames,
      rankedWins: p.rankedWins,
      casualGames: p.casualGames,
    };
  }

  private load() {
    const file = this.opts.dataFile;
    if (!file || !existsSync(file)) return;
    for (const p of JSON.parse(readFileSync(file, "utf8")) as Profile[]) {
      this.profiles.set(p.token, p);
      this.byId.set(p.id, p);
    }
  }

  private scheduleSave() {
    const file = this.opts.dataFile;
    if (!file || this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify([...this.profiles.values()]));
    }, 1000);
  }

  stop(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer);
    for (const r of this.rooms.values()) r.dispose();
  }
}

function sanitizeName(v: unknown): string {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16) : "";
  return s || "ゲスト";
}

function clampInt(v: unknown, min: number, max: number, def: number): number {
  return typeof v === "number" && Number.isInteger(v) ? Math.min(max, Math.max(min, v)) : def;
}
