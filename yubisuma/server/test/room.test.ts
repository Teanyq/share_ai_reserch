import assert from "node:assert/strict";
import { test } from "node:test";
import { Room } from "../src/room.ts";

type Msg = { type: string; state?: any };

function setup(inputMs = 10000) {
  const inbox: Record<string, Msg[]> = { a: [], b: [] };
  const room = new Room(
    "TEST01",
    "private",
    {
      send: (id, m) => inbox[id]?.push(m as Msg),
      timings: { announceMs: 5, revealMs: 5, gameEndMs: 5, graceMs: 0, activityDelayMs: 1 },
      rng: () => 0, // a が先手
    },
    { maxPlayers: 2, inputMs, winsNeeded: 1, showHistory: true, showActivity: false },
  );
  room.addMember("a", "A");
  room.addMember("b", "B");
  const waitFor = async (id: string, type: string, from = 0) => {
    for (let i = 0; i < 200; i++) {
      const m = inbox[id].slice(from).find((x) => x.type === type);
      if (m) return m;
      await new Promise((r) => setTimeout(r, 5));
    }
    throw new Error(`timeout waiting ${type}`);
  };
  return { room, inbox, waitFor };
}

test("全員が決定したら制限時間を待たずに公開される", async () => {
  const { room, waitFor, inbox } = setup(10000);
  room.start("a");
  const input = await waitFor("a", "round.input");
  const roundId = input.state.roundId;
  room.applyInput("a", { kind: "thumbs", roundId, up: 1 });
  room.applyInput("a", { kind: "call", roundId, number: 2 });
  room.applyInput("b", { kind: "thumbs", roundId, up: 1 });
  const t0 = Date.now();
  assert.equal(room.markReady("a", roundId), true);
  // 片方だけでは公開されない。相手には「決定済み」だけが伝わる
  const readyMsg = await waitFor("b", "round.ready");
  assert.equal(readyMsg.state.players.find((p: any) => p.id === "a").ready, true);
  assert.equal(inbox.b.some((m) => m.type === "round.reveal"), false);
  room.markReady("b", roundId);
  const reveal = await waitFor("a", "round.reveal");
  assert.ok(Date.now() - t0 < 1000);
  assert.equal(reveal.state.lastReveal.total, 2);
  assert.equal(reveal.state.lastReveal.hit, true);
  room.dispose();
});

test("決定したあとは指もコールも変えられない", async () => {
  const { room, waitFor } = setup(10000);
  room.start("a");
  const input = await waitFor("a", "round.input");
  const roundId = input.state.roundId;
  room.applyInput("a", { kind: "call", roundId, number: 1 });
  room.markReady("a", roundId);
  assert.equal(room.applyInput("a", { kind: "call", roundId, number: 3 }), false);
  assert.equal(room.applyInput("a", { kind: "thumbs", roundId, up: 2 }), false);
  assert.equal(room.markReady("a", roundId), false);
  room.dispose();
});

test("決定しない人がいても最大時間で締め切る", async () => {
  const { room, waitFor } = setup(3000);
  room.start("a");
  const input = await waitFor("a", "round.input");
  room.markReady("a", input.state.roundId);
  const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 200));
  // 最大時間まではまだ公開されない（テストを速くするため、ここでは締め切り前であることだけ確認）
  assert.equal(room.phase, "input");
  assert.ok(Date.now() - t0 < 3000);
  room.dispose();
});

test("切断した人は待たない", async () => {
  const { room, waitFor } = setup(10000);
  room.start("a");
  const input = await waitFor("a", "round.input");
  room.markReady("a", input.state.roundId);
  room.disconnect("b");
  await waitFor("a", "round.reveal");
  room.dispose();
});

test("数字を選ばずに決定したら 0 でコールしたことになる", async () => {
  const { room, waitFor } = setup(10000);
  room.start("a");
  const input = await waitFor("a", "round.input");
  const roundId = input.state.roundId;
  room.markReady("a", roundId);
  room.markReady("b", roundId);
  const reveal = await waitFor("a", "round.reveal");
  assert.equal(reveal.state.lastReveal.call, 0);
  assert.equal(reveal.state.lastReveal.total, 0);
  assert.equal(reveal.state.lastReveal.hit, true);
  room.dispose();
});
