import assert from "node:assert/strict";
import { test } from "node:test";
import { callRange, createGame, defaultRuleConfig, resolveRound, type GameState } from "../src/rules.ts";

const cfg = defaultRuleConfig(2);
const game2 = () => createGame(["a", "b"], cfg, 0);

test("合計が一致するとコーラーの手が1本減り、手番が回る", () => {
  const { state, result } = resolveRound(game2(), { a: 1, b: 2 }, 3);
  assert.equal(result.hit, true);
  assert.equal(result.total, 3);
  assert.equal(state.players[0].hands, 1);
  assert.equal(state.players[0].hits, 1);
  assert.equal(state.callerIndex, 1);
  assert.equal(state.round, 1);
});

test("外れたら手は減らない", () => {
  const { state, result } = resolveRound(game2(), { a: 1, b: 2 }, 2);
  assert.equal(result.hit, false);
  assert.deepEqual(state.players.map((p) => p.hands), [2, 2]);
});

test("未入力のコール(null)と範囲外のコールは必ずハズレ", () => {
  assert.equal(resolveRound(game2(), { a: 0, b: 0 }, null).result.hit, false);
  const r = resolveRound(game2(), { a: 0, b: 0 }, -1).result;
  assert.equal(r.hit, false);
  assert.equal(r.call, null);
});

test("親指の数は残り手の範囲に補正される", () => {
  const { result } = resolveRound(game2(), { a: 5, b: -3 }, 2);
  assert.deepEqual(result.thumbs, { a: 2, b: 0 });
  assert.equal(result.hit, true);
});

test("手が0本になったら勝ち抜け、1v1ならゲーム終了", () => {
  let s = game2();
  s = resolveRound(s, { a: 0, b: 0 }, 0).state; // a 当たり → 1本
  s = resolveRound(s, { a: 0, b: 0 }, 1).state; // b 外れ
  const { state, result } = resolveRound(s, { a: 1, b: 0 }, 1); // a 当たり → 0本
  assert.deepEqual(result.finished, ["a"]);
  assert.equal(state.over, true);
  assert.deepEqual(state.placements, ["a", "b"]);
});

test("抜けたプレイヤーは手番をスキップされ、合計にも含まれない", () => {
  let s: GameState = createGame(["a", "b", "c"], defaultRuleConfig(3), 0);
  s = { ...s, players: s.players.map((p) => (p.id === "b" ? { ...p, hands: 0 } : p)), placements: ["b"] };
  assert.deepEqual(callRange(s), [0, 4]);
  const { state, result } = resolveRound(s, { a: 1, b: 2, c: 1 }, 5);
  assert.equal(result.total, 2);
  assert.equal(state.callerIndex, 2);
});

test("4人戦：抜けた順に順位が付き、最後の1人が最下位", () => {
  let s = createGame(["a", "b", "c", "d"], defaultRuleConfig(4), 0);
  s = { ...s, players: s.players.map((p) => ({ ...p, hands: p.id === "d" ? 2 : 1 })) };
  s = resolveRound(s, { a: 0, b: 0, c: 0, d: 0 }, 0).state; // a 抜け
  s = resolveRound(s, { b: 1, c: 0, d: 0 }, 1).state; // b 抜け
  const { state } = resolveRound(s, { c: 0, d: 0 }, 0); // c 抜け → 終了
  assert.equal(state.over, true);
  assert.deepEqual(state.placements, ["a", "b", "c", "d"]);
});

test("サドンデス：指定ラウンド後は当てると手が2本減る", () => {
  let s = createGame(["a", "b"], { ...cfg, suddenDeathRound: 2 }, 0);
  s = resolveRound(s, { a: 0, b: 0 }, 4).state;
  assert.equal(s.suddenDeath, false);
  s = resolveRound(s, { a: 0, b: 0 }, 4).state;
  assert.equal(s.suddenDeath, true);
  const { state } = resolveRound(s, { a: 0, b: 0 }, 0);
  assert.equal(state.players[0].hands, 0);
  assert.equal(state.over, true);
});

test("ラウンド上限で強制決着：残り手が少ない順 → 当てた回数が多い順", () => {
  let s = createGame(["a", "b", "c"], { ...defaultRuleConfig(3), suddenDeathRound: 1, suddenDeathMaxRounds: 1 }, 0);
  s = { ...s, round: 1, players: [{ id: "a", hands: 2, hits: 0 }, { id: "b", hands: 1, hits: 0 }, { id: "c", hands: 1, hits: 3 }] };
  const { state } = resolveRound(s, { a: 0, b: 0, c: 0 }, 5);
  assert.equal(state.over, true);
  assert.equal(state.timedOut, true);
  assert.deepEqual(state.placements, ["c", "b", "a"]);
});
