// 実際に WebSocket サーバを立てて、ボットクライアント同士で対戦させる結合テスト
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { after, before, test } from "node:test";
import WebSocket from "ws";
import { startServer } from "../src/main.ts";

type Msg = { type: string; state?: any; [k: string]: any };

let server: ReturnType<typeof startServer>;
let url: string;

before(async () => {
  server = startServer(0, {
    casualCpuFillMs: 0,
    roomDeps: { timings: { announceMs: 5, revealMs: 5, gameEndMs: 5, graceMs: 20, activityDelayMs: 1, reconnectGraceMs: 300 } },
    forceSettings: { inputMs: 60 },
  });
  await new Promise((r) => server.httpServer.once("listening", r));
  url = `ws://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}/ws`;
});
after(() => server.close());

class Bot {
  ws!: WebSocket;
  msgs: Msg[] = [];
  waiters: { pred: (m: Msg) => boolean; resolve: (m: Msg) => void }[] = [];
  id = "";
  token = "";
  autoplay = true;
  seenInputPhases = 0;

  async connect(name: string, token?: string) {
    this.ws = new WebSocket(url);
    this.ws.on("message", (d) => this.onMessage(JSON.parse(d.toString())));
    await new Promise((r) => this.ws.once("open", r));
    this.send({ type: "hello", name, token });
    const w = await this.waitFor((m) => m.type === "welcome");
    this.id = w.playerId;
    this.token = w.token;
    return this;
  }
  send(m: object) {
    this.ws.send(JSON.stringify(m));
  }
  onMessage(m: Msg) {
    this.msgs.push(m);
    if (this.autoplay && m.type === "round.input") {
      const s = m.state;
      this.seenInputPhases++;
      const me = s.players.find((p: any) => p.id === this.id);
      if (me?.hands) {
        this.send({ type: "input.thumbs", roundId: s.roundId, up: Math.floor(Math.random() * (me.hands + 1)) });
        if (s.callerId === this.id) {
          this.send({ type: "input.call", roundId: s.roundId, number: Math.floor(Math.random() * (s.callRange[1] + 1)) });
        }
        this.send({ type: "input.ready", roundId: s.roundId });
      }
    }
    this.waiters = this.waiters.filter((w) => (w.pred(m) ? (w.resolve(m), false) : true));
  }
  waitFor(pred: (m: Msg) => boolean, timeoutMs = 20000): Promise<Msg> {
    const found = this.msgs.find(pred);
    if (found) return Promise.resolve(found);
    return new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("timeout")), timeoutMs);
      this.waiters.push({ pred, resolve: (m) => (clearTimeout(t), resolve(m)) });
    });
  }
  close() {
    this.ws.close();
  }
}

test("CPU 練習：1人でも最後まで遊べる", async () => {
  const a = await new Bot().connect("あ");
  a.send({ type: "practice.start", cpus: 1, level: 2 });
  const end = await a.waitFor((m) => m.type === "match.end");
  assert.equal(end.state.match.placements.length, 2);
  assert.ok(end.state.match.placements.includes(a.id));
  a.close();
});

test("プライベートマッチ：コードで参加して BO3、入力中は相手の入力が見えない", async () => {
  const a = await new Bot().connect("ホスト");
  const b = await new Bot().connect("ゲスト");
  a.send({ type: "room.create", settings: { maxPlayers: 2, winsNeeded: 2 } });
  const created = await a.waitFor((m) => m.type === "room.update");
  b.send({ type: "room.join", code: created.state.code.toLowerCase() });
  await a.waitFor((m) => m.type === "room.update" && m.state.players.length === 2);
  a.send({ type: "room.start" });
  const [ea, eb] = await Promise.all([a.waitFor((m) => m.type === "match.end"), b.waitFor((m) => m.type === "match.end")]);
  assert.deepEqual(ea.state.match.placements, eb.state.match.placements);
  const winner = ea.state.players.find((p: any) => p.id === ea.state.match.placements[0]);
  assert.equal(winner.wins, 2);
  // 入力中のメッセージに相手のコールが含まれていないこと
  for (const m of b.msgs.filter((x) => x.state?.phase === "input")) {
    if (m.state.callerId !== b.id) assert.equal(m.state.you.call, null);
  }
  a.close();
  b.close();
});

test("ランクマッチ：マッチングして BO3、勝者のレートが上がる", async () => {
  const a = await new Bot().connect("ランカーA");
  const b = await new Bot().connect("ランカーB");
  a.send({ type: "queue.join", mode: "ranked" });
  b.send({ type: "queue.join", mode: "ranked" });
  const end = await a.waitFor((m) => m.type === "match.end");
  const [winner, loser] = end.state.match.placements;
  const ratings = end.state.match.extra.ratings;
  assert.ok(ratings[winner].delta > 0);
  assert.ok(ratings[loser].delta < 0);
  assert.equal(ratings[winner].tier, "配置戦 1/5");
  a.send({ type: "profile.get" });
  const prof = await a.waitFor((m) => m.type === "profile");
  assert.equal(prof.profile.rankedGames, 1);
  a.close();
  b.close();
});

test("ランクマッチ：途中退出は棄権負け", async () => {
  const a = await new Bot().connect("逃げる人");
  const b = await new Bot().connect("残る人");
  a.send({ type: "queue.join", mode: "ranked" });
  b.send({ type: "queue.join", mode: "ranked" });
  await a.waitFor((m) => m.type === "round.input");
  a.send({ type: "room.leave" });
  const end = await b.waitFor((m) => m.type === "match.end");
  assert.equal(end.state.match.forfeitedBy, a.id);
  assert.deepEqual(end.state.match.placements, [b.id, a.id]);
  a.close();
  b.close();
});

test("切断してもトークンで再接続すれば対戦に戻れる", async () => {
  const a = await new Bot().connect("回線弱い人");
  const b = await new Bot().connect("相手");
  a.send({ type: "room.create", settings: { maxPlayers: 2, winsNeeded: 5 } });
  const created = await a.waitFor((m) => m.type === "room.update");
  b.send({ type: "room.join", code: created.state.code });
  await a.waitFor((m) => m.type === "room.update" && m.state.players.length === 2);
  a.send({ type: "room.start" });
  await a.waitFor((m) => m.type === "round.input");
  a.close();
  await b.waitFor((m) => m.type === "room.update" && m.state.players.some((p: any) => p.id === a.id && !p.connected));
  const a2 = await new Bot().connect("回線弱い人", a.token);
  assert.equal(a2.id, a.id);
  const st = await a2.waitFor((m) => m.type === "state");
  assert.equal(st.state.code, created.state.code);
  assert.notEqual(st.state.phase, "lobby");
  a2.send({ type: "room.leave" });
  b.send({ type: "room.leave" });
  a2.close();
  b.close();
});

test("カジュアル：人が足りなければ CPU で4人に補充される", async () => {
  const a = await new Bot().connect("ぼっち");
  a.send({ type: "queue.join", mode: "casual" });
  const start = await a.waitFor((m) => m.type === "match.start");
  assert.equal(start.state.players.length, 4);
  assert.equal(start.state.players.filter((p: any) => p.isCpu).length, 3);
  const end = await a.waitFor((m) => m.type === "match.end");
  assert.equal(end.state.match.placements.length, 4);
  a.close();
});

test("同じトークンで別の場所から接続すると古い接続に kicked が届く", async () => {
  const a = await new Bot().connect("本人");
  const a2 = await new Bot().connect("本人", a.token);
  const kicked = await a.waitFor((m) => m.type === "kicked");
  assert.match(kicked.message, /別の場所/);
  assert.equal(a2.id, a.id);
  a2.close();
});

test("掛け声は個人設定。コールする人の掛け声が全員に配られる", async () => {
  const a = await new Bot().connect("関西の人");
  a.send({ type: "profile.update", chant: "  ゆびスマ\n " });
  const prof = await a.waitFor((m) => m.type === "profile");
  assert.equal(prof.profile.chant, "ゆびスマ");
  const b = await new Bot().connect("関東の人");
  a.send({ type: "room.create", settings: { maxPlayers: 2 } });
  const created = await a.waitFor((m) => m.type === "room.update");
  b.send({ type: "room.join", code: created.state.code });
  const both = await b.waitFor((m) => m.type === "room.update" && m.state.players.length === 2);
  const chants = Object.fromEntries(both.state.players.map((p: any) => [p.name, p.chant]));
  assert.deepEqual(chants, { 関西の人: "ゆびスマ", 関東の人: "いっせーのーで" });
  b.send({ type: "profile.update", chant: "" });
  await b.waitFor((m) => m.type === "profile");
  a.send({ type: "room.leave" });
  b.send({ type: "room.leave" });
  a.close();
  b.close();
});
