// ゲームルーム：1 つの対戦（BO-N）を進行する状態機械。すべての判定はここ（サーバ）で行う。

import { decide, type CpuLevel } from "./cpu.ts";
import {
  activePlayers,
  callRange,
  clampThumbs,
  createGame,
  currentCaller,
  defaultRuleConfig,
  resolveRound,
  type GameState,
  type RoundResult,
} from "./rules.ts";

export type RoomMode = "private" | "casual" | "ranked" | "practice";
export type Phase = "lobby" | "announce" | "input" | "reveal" | "gameEnd" | "matchEnd";

export interface RoomSettings {
  maxPlayers: number;
  /** 入力の最大時間。全員が「決定」したらその時点で締め切る */
  inputMs: number;
  winsNeeded: number;
  showHistory: boolean;
  /** 入力を変えた瞬間に相手の手が「ピクッ」と動く（値は漏れない） */
  showActivity: boolean;
}

export const defaultSettings = (mode: RoomMode): RoomSettings => ({
  maxPlayers: mode === "ranked" ? 2 : 4,
  inputMs: 10000,
  winsNeeded: mode === "ranked" ? 2 : 1,
  showHistory: true,
  showActivity: mode !== "ranked",
});

export function sanitizeSettings(input: Partial<RoomSettings>, base: RoomSettings): RoomSettings {
  const num = (v: unknown, min: number, max: number, def: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : def;
  return {
    maxPlayers: Math.round(num(input.maxPlayers, 2, 4, base.maxPlayers)),
    inputMs: Math.round(num(input.inputMs, 3000, 10000, base.inputMs) / 500) * 500,
    winsNeeded: Math.round(num(input.winsNeeded, 1, 5, base.winsNeeded)),
    showHistory: typeof input.showHistory === "boolean" ? input.showHistory : base.showHistory,
    showActivity: typeof input.showActivity === "boolean" ? input.showActivity : base.showActivity,
  };
}

export interface Timings {
  announceMs: number;
  revealMs: number;
  gameEndMs: number;
  /** 締切後に受け付ける猶予（通信の揺らぎ吸収。他人の入力は見えないので有利にならない） */
  graceMs: number;
  activityDelayMs: number;
  reconnectGraceMs: number;
}

export const defaultTimings: Timings = {
  announceMs: 1000,
  revealMs: 3000,
  gameEndMs: 3500,
  graceMs: 100,
  activityDelayMs: 150,
  reconnectGraceMs: 30000,
};

export interface Member {
  id: string;
  name: string;
  isCpu: boolean;
  cpuLevel: CpuLevel;
  connected: boolean;
}

export interface MatchEndInfo {
  placements: string[];
  forfeitedBy: string | null;
}

export interface RoomDeps {
  send(playerId: string, msg: object): void;
  /** 対戦終了時に呼ばれる。戻り値は match.end メッセージに含められる（レート変動など） */
  onMatchEnd?(room: Room, info: MatchEndInfo): object | void;
  /** ルームに接続中の人間がいなくなった */
  onEmpty?(room: Room): void;
  timings?: Partial<Timings>;
  rng?: () => number;
}

const HISTORY_SHOWN = 5;

export class Room {
  readonly code: string;
  readonly mode: RoomMode;
  settings: RoomSettings;
  hostId: string | null = null;
  members: Member[] = [];
  phase: Phase = "lobby";

  private deps: RoomDeps;
  private t: Timings;
  private rng: () => number;
  private game: GameState | null = null;
  private gameNo = 0;
  private wins: Record<string, number> = {};
  private roundId = 0;
  private thumbs: Record<string, number> = {};
  private call: number | null = null;
  /** このラウンドで「決定」したプレイヤー */
  private ready = new Set<string>();
  private history: Record<string, number[]> = {};
  private lastReveal: RoundResult | null = null;
  private lastPlacements: string[] = [];
  private matchResult: (MatchEndInfo & { extra?: object }) | null = null;
  private phaseEndsAt = 0;
  private phaseTimer: NodeJS.Timeout | null = null;
  private roundTimers = new Set<NodeJS.Timeout>();
  private graceTimers = new Map<string, NodeJS.Timeout>();
  private cpuSeq = 0;

  constructor(code: string, mode: RoomMode, deps: RoomDeps, settings?: RoomSettings) {
    this.code = code;
    this.mode = mode;
    this.deps = deps;
    this.t = { ...defaultTimings, ...deps.timings };
    this.rng = deps.rng ?? Math.random;
    this.settings = settings ?? defaultSettings(mode);
  }

  get inMatch() {
    return this.phase !== "lobby" && this.phase !== "matchEnd";
  }

  get isFull() {
    return this.members.length >= this.settings.maxPlayers;
  }

  humans() {
    return this.members.filter((m) => !m.isCpu);
  }

  // ───────── メンバー管理 ─────────

  addMember(id: string, name: string): void {
    if (this.inMatch) throw new Error("対戦中のため参加できません");
    if (this.isFull) throw new Error("ルームが満員です");
    if (this.members.some((m) => m.id === id)) return;
    this.members.push({ id, name, isCpu: false, cpuLevel: 2, connected: true });
    this.hostId ??= id;
    this.broadcast("room.update");
  }

  addCpu(level: CpuLevel = 2): void {
    if (this.inMatch) throw new Error("対戦中は追加できません");
    if (this.isFull) throw new Error("ルームが満員です");
    const id = `cpu-${this.code}-${++this.cpuSeq}`;
    this.members.push({ id, name: `CPU ${this.cpuSeq} (Lv${level})`, isCpu: true, cpuLevel: level, connected: true });
    this.broadcast("room.update");
  }

  removeCpu(id: string): void {
    if (this.inMatch) throw new Error("対戦中は外せません");
    this.members = this.members.filter((m) => !(m.isCpu && m.id === id));
    this.broadcast("room.update");
  }

  updateSettings(byId: string, input: Partial<RoomSettings>): void {
    if (this.mode !== "private") throw new Error("このルームの設定は変更できません");
    if (byId !== this.hostId) throw new Error("ホストのみ変更できます");
    if (this.inMatch) throw new Error("対戦中は変更できません");
    const next = sanitizeSettings(input, this.settings);
    if (next.maxPlayers < this.members.length) next.maxPlayers = this.members.length;
    this.settings = next;
    this.broadcast("room.update");
  }

  /** 自発的な退出。対戦中ならランクは即敗北、それ以外は CPU が引き継ぐ */
  leave(id: string): void {
    const m = this.members.find((x) => x.id === id && !x.isCpu);
    if (!m) return;
    if (this.inMatch) {
      if (this.mode === "ranked") return this.forfeit(id);
      this.takeOverByCpu(m);
    } else {
      this.members = this.members.filter((x) => x !== m);
      if (this.hostId === id) this.hostId = this.humans()[0]?.id ?? null;
      this.broadcast("room.update");
    }
    this.checkEmpty();
  }

  disconnect(id: string): void {
    const m = this.members.find((x) => x.id === id && !x.isCpu);
    if (!m) return;
    if (!this.inMatch) return this.leave(id);
    m.connected = false;
    this.broadcast("room.update");
    this.checkAllReady();
    const timer = setTimeout(() => {
      this.graceTimers.delete(id);
      if (m.connected || !this.inMatch) return;
      if (this.mode === "ranked") this.forfeit(id);
      else this.takeOverByCpu(m);
    }, this.t.reconnectGraceMs);
    this.graceTimers.set(id, timer);
    this.checkEmpty();
  }

  reconnect(id: string): boolean {
    const m = this.members.find((x) => x.id === id && !x.isCpu);
    if (!m) return false;
    m.connected = true;
    const timer = this.graceTimers.get(id);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(id);
    this.broadcast("room.update");
    return true;
  }

  private takeOverByCpu(m: Member) {
    m.isCpu = true;
    m.connected = true;
    m.cpuLevel = 2;
    m.name = `${m.name}（CPU代行）`;
    if (this.phase === "input") this.ready.add(m.id);
    if (this.hostId === m.id) this.hostId = this.humans()[0]?.id ?? null;
    this.broadcast("room.update");
    this.checkEmpty();
  }

  private checkEmpty() {
    if (this.humans().every((h) => !h.connected)) {
      this.dispose();
      this.deps.onEmpty?.(this);
    }
  }

  dispose(): void {
    this.clearRoundTimers();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    for (const t of this.graceTimers.values()) clearTimeout(t);
    this.graceTimers.clear();
  }

  // ───────── 進行 ─────────

  start(byId?: string): void {
    if (this.inMatch) throw new Error("すでに対戦中です");
    if (byId !== undefined && byId !== this.hostId) throw new Error("ホストのみ開始できます");
    if (this.members.length < 2) throw new Error("2人以上必要です");
    this.wins = Object.fromEntries(this.members.map((m) => [m.id, 0]));
    this.history = Object.fromEntries(this.members.map((m) => [m.id, []]));
    this.gameNo = 0;
    this.lastPlacements = [];
    this.matchResult = null;
    this.broadcast("match.start");
    this.startGame();
  }

  private startGame() {
    this.gameNo += 1;
    const ids = this.members.map((m) => m.id);
    // 1 ゲーム目はランダム、以降は前ゲームの最下位が先手
    const loser = this.lastPlacements.at(-1);
    const first = loser ? ids.indexOf(loser) : Math.floor(this.rng() * ids.length);
    this.game = createGame(ids, defaultRuleConfig(ids.length), first);
    this.thumbs = Object.fromEntries(ids.map((id) => [id, 0]));
    this.lastReveal = null;
    this.broadcast("game.start");
    this.beginRound();
  }

  private beginRound() {
    this.roundId += 1;
    this.call = null;
    this.ready.clear();
    this.setPhase("announce", this.t.announceMs, () => this.openInput());
  }

  private openInput() {
    const game = this.game!;
    this.setPhase("input", this.settings.inputMs + this.t.graceMs, () => this.closeInput(), this.settings.inputMs);
    const caller = currentCaller(game).id;
    const hands = Object.fromEntries(activePlayers(game).map((p) => [p.id, p.hands]));
    for (const m of this.members) {
      if (!m.isCpu || !(m.id in hands)) continue;
      // CPU は 1〜3.5 秒くらい考えてから決定する
      const delay = Math.min(this.settings.inputMs * 0.8, 1000 + this.rng() * 2500);
      const timer = setTimeout(() => {
        this.roundTimers.delete(timer);
        const d = decide(m.cpuLevel, { selfId: m.id, isCaller: m.id === caller, hands, history: this.history }, this.rng);
        this.applyInput(m.id, { kind: "thumbs", roundId: this.roundId, up: d.thumbs });
        if (d.call !== null) this.applyInput(m.id, { kind: "call", roundId: this.roundId, number: d.call });
        this.markReady(m.id, this.roundId);
      }, delay);
      this.roundTimers.add(timer);
    }
  }

  /** クライアント/CPU からの入力。受け付けたら true */
  applyInput(
    id: string,
    input: { kind: "thumbs"; roundId: number; up: number } | { kind: "call"; roundId: number; number: number },
  ): boolean {
    const game = this.game;
    if (this.phase !== "input" || !game || input.roundId !== this.roundId) return false;
    const p = game.players.find((x) => x.id === id);
    if (!p || p.hands === 0 || this.ready.has(id)) return false;
    if (input.kind === "thumbs") {
      const up = clampThumbs(input.up, p.hands);
      if (up !== this.thumbs[id]) {
        this.thumbs[id] = up;
        if (this.settings.showActivity) this.emitActivity(id);
      }
    } else {
      if (currentCaller(game).id !== id) return false;
      const [min, max] = callRange(game);
      if (!Number.isInteger(input.number) || input.number < min || input.number > max) return false;
      this.call = input.number;
    }
    this.sendState(id, "input.ack");
    return true;
  }

  /** 「決定」。以降そのラウンドの入力は変えられない。全員そろえば即締め切り */
  markReady(id: string, roundId: number): boolean {
    const game = this.game;
    if (this.phase !== "input" || !game || roundId !== this.roundId) return false;
    const p = game.players.find((x) => x.id === id);
    if (!p || p.hands === 0 || this.ready.has(id)) return false;
    this.ready.add(id);
    this.broadcast("round.ready");
    this.checkAllReady();
    return true;
  }

  private checkAllReady() {
    if (this.phase !== "input" || !this.game) return;
    const waiting = activePlayers(this.game).some((p) => {
      const m = this.members.find((x) => x.id === p.id);
      // 切断中の人は待たない（前ラウンドの指のまま・コールなし）
      return m !== undefined && m.connected && !this.ready.has(p.id);
    });
    if (!waiting) this.closeInput();
  }

  private emitActivity(id: string) {
    const timer = setTimeout(() => {
      this.roundTimers.delete(timer);
      for (const m of this.members) {
        if (!m.isCpu && m.id !== id) this.deps.send(m.id, { type: "round.activity", playerId: id });
      }
    }, this.t.activityDelayMs);
    this.roundTimers.add(timer);
  }

  private closeInput() {
    this.clearRoundTimers();
    // 数字を選ばずに決定・時間切れになったコーラーは「0」でコールしたことにする
    const { state, result } = resolveRound(this.game!, this.thumbs, this.call ?? 0);
    this.game = state;
    this.lastReveal = result;
    for (const [id, n] of Object.entries(result.thumbs)) this.history[id].push(n);
    this.setPhase("reveal", this.t.revealMs, () => (state.over ? this.endGame() : this.beginRound()));
    this.broadcast("round.reveal");
  }

  private endGame() {
    const placements = this.game!.placements;
    this.lastPlacements = placements;
    this.wins[placements[0]] += 1;
    const done = this.wins[placements[0]] >= this.settings.winsNeeded;
    this.setPhase("gameEnd", this.t.gameEndMs, () => (done ? this.endMatch(null) : this.startGame()));
    this.broadcast("game.end");
  }

  private endMatch(forfeitedBy: string | null) {
    this.clearRoundTimers();
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phaseTimer = null;
    // 勝ち数が多い順 → 最終ゲームの順位順。棄権者は最下位
    const lastRank = (id: string) => {
      const i = this.lastPlacements.indexOf(id);
      return i === -1 ? Infinity : i;
    };
    const placements = this.members
      .map((m) => m.id)
      .sort(
        (a, b) =>
          Number(a === forfeitedBy) - Number(b === forfeitedBy) ||
          this.wins[b] - this.wins[a] ||
          lastRank(a) - lastRank(b),
      );
    const info: MatchEndInfo = { placements, forfeitedBy };
    this.phase = "matchEnd";
    this.matchResult = { ...info, extra: this.deps.onMatchEnd?.(this, info) ?? undefined };
    this.broadcast("match.end");
  }

  private forfeit(id: string) {
    if (!this.inMatch) return;
    const m = this.members.find((x) => x.id === id);
    if (m) m.connected = false;
    this.endMatch(id);
  }

  private setPhase(phase: Phase, ms: number, next: () => void, shownMs = ms) {
    if (this.phaseTimer) clearTimeout(this.phaseTimer);
    this.phase = phase;
    this.phaseEndsAt = Date.now() + shownMs;
    this.phaseTimer = setTimeout(() => {
      this.phaseTimer = null;
      next();
    }, ms);
    if (phase === "announce" || phase === "input") this.broadcast(phase === "announce" ? "round.announce" : "round.input");
  }

  private clearRoundTimers() {
    for (const t of this.roundTimers) clearTimeout(t);
    this.roundTimers.clear();
  }

  // ───────── 送信 ─────────

  emote(id: string, emoteId: number): void {
    if (!Number.isInteger(emoteId) || emoteId < 0 || emoteId > 7) return;
    for (const m of this.humans()) this.deps.send(m.id, { type: "emote", playerId: id, emoteId });
  }

  broadcast(type: string): void {
    for (const m of this.members) if (!m.isCpu && m.connected) this.sendState(m.id, type);
  }

  sendState(id: string, type = "state"): void {
    this.deps.send(id, { type, state: this.snapshot(id) });
  }

  /** 受信者ごとのスナップショット。入力フェーズ中の他人の入力は絶対に含めない */
  snapshot(forId: string) {
    const game = this.game;
    const inGame = game !== null && this.phase !== "lobby";
    const caller = inGame ? currentCaller(game).id : null;
    return {
      code: this.code,
      mode: this.mode,
      phase: this.phase,
      hostId: this.hostId,
      settings: this.settings,
      gameNo: this.gameNo,
      roundId: this.roundId,
      round: inGame ? game.round + (this.phase === "announce" || this.phase === "input" ? 1 : 0) : 0,
      suddenDeath: inGame ? game.suddenDeath : false,
      callerId: caller,
      callRange: inGame ? callRange(game) : null,
      phaseRemainingMs: Math.max(0, this.phaseEndsAt - Date.now()),
      players: this.members.map((m) => {
        const p = inGame ? game.players.find((x) => x.id === m.id) : undefined;
        const placed = inGame ? game.placements.indexOf(m.id) : -1;
        return {
          id: m.id,
          name: m.name,
          isCpu: m.isCpu,
          connected: m.connected,
          hands: p?.hands ?? null,
          hits: p?.hits ?? 0,
          placed: placed === -1 ? null : placed + 1,
          wins: this.wins[m.id] ?? 0,
          history: this.settings.showHistory ? (this.history[m.id] ?? []).slice(-HISTORY_SHOWN) : [],
          ready: this.phase === "input" && this.ready.has(m.id),
        };
      }),
      you: {
        id: forId,
        thumbs: this.thumbs[forId] ?? 0,
        call: caller === forId ? this.call : null,
      },
      lastReveal: this.lastReveal,
      gamePlacements: inGame ? game.placements : [],
      match: this.phase === "matchEnd" ? this.matchResult : null,
    };
  }
}
