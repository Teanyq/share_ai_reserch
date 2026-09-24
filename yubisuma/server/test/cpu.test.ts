import assert from "node:assert/strict";
import { test } from "node:test";
import { decide } from "../src/cpu.ts";

test("コーラーでなければコールしない", () => {
  const d = decide(2, { selfId: "c", isCaller: false, hands: { c: 2, p: 2 }, history: {} });
  assert.equal(d.call, null);
  assert.ok(d.thumbs >= 0 && d.thumbs <= 2);
});

test("Lv1 のコールは常に取りうる範囲内", () => {
  for (let i = 0; i < 200; i++) {
    const d = decide(1, { selfId: "c", isCaller: true, hands: { c: 1, p: 2, q: 2 }, history: {} });
    assert.ok(d.call! >= d.thumbs && d.call! <= d.thumbs + 4 && d.thumbs <= 1);
  }
});

test("Lv2 は相手の癖（いつも2本）を読んでコールする", () => {
  for (let i = 0; i < 50; i++) {
    const d = decide(2, { selfId: "c", isCaller: true, hands: { c: 2, p: 2 }, history: { p: [2, 2, 2, 2, 2, 2] } });
    assert.equal(d.call, d.thumbs + 2);
  }
});
