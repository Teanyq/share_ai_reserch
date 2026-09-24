import assert from "node:assert/strict";
import { test } from "node:test";
import { displayRating, initialRating, tierName, update } from "../src/glicko2.ts";

test("勝てば上がり、負ければ下がる。RD は縮む", () => {
  const a = initialRating();
  const b = initialRating();
  const win = update(a, b, 1);
  const lose = update(b, a, 0);
  assert.ok(win.rating > 1500 && lose.rating < 1500);
  assert.ok(Math.abs(win.rating - 1500 - (1500 - lose.rating)) < 1e-6);
  assert.ok(win.rd < 350);
});

test("格上に勝つほど大きく上がる", () => {
  const me = { rating: 1500, rd: 80, vol: 0.06 };
  const upset = update(me, { rating: 1800, rd: 80, vol: 0.06 }, 1).rating - 1500;
  const expected = update(me, { rating: 1200, rd: 80, vol: 0.06 }, 1).rating - 1500;
  assert.ok(upset > expected);
});

test("表示レートとランク帯", () => {
  assert.equal(displayRating({ rating: 1700, rd: 50, vol: 0.06 }), 1600);
  assert.equal(tierName(1600, 2), "配置戦 2/5");
  assert.equal(tierName(1250, 10), "ブロンズ I");
  assert.equal(tierName(1310, 10), "シルバー III");
  assert.equal(tierName(1699, 10), "ゴールド I");
  assert.equal(tierName(2150, 10), "マスター");
});
