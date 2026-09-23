import { test } from "node:test";
import assert from "node:assert/strict";
import { extractJson, toMarkdown, createRateLimiter, UUID_RE } from "./lib.js";

test("extractJson pulls a JSON array out of surrounding prose", () => {
  const raw = 'Sure, here you go:\n[{"id":"a1","title":"x"}]\nhope that helps';
  assert.deepEqual(extractJson(raw), [{ id: "a1", title: "x" }]);
});

test("extractJson parses a bare JSON array", () => {
  assert.deepEqual(extractJson('[{"id":"a1"}]'), [{ id: "a1" }]);
});

test("toMarkdown renders goal, subtasks and final output", () => {
  const md = toMarkdown({
    goal: "Test goal",
    completedAt: "2026-01-01T00:00:00.000Z",
    subtasks: [{ title: "Sub A", output: "result A" }],
    final: "final answer",
  });
  assert.match(md, /# Test goal/);
  assert.match(md, /### Sub A/);
  assert.match(md, /result A/);
  assert.match(md, /## Final Output/);
  assert.match(md, /final answer/);
});

test("rate limiter allows up to max requests in the window, then blocks", () => {
  const check = createRateLimiter({ windowMs: 1000, max: 2 });
  const t0 = 0;
  assert.equal(check("ip1", t0), true);
  assert.equal(check("ip1", t0), true);
  assert.equal(check("ip1", t0), false); // 3rd request in window is blocked
});

test("rate limiter resets after the window elapses", () => {
  const check = createRateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(check("ip1", 0), true);
  assert.equal(check("ip1", 500), false);
  assert.equal(check("ip1", 1500), true); // window has passed
});

test("rate limiter tracks keys independently", () => {
  const check = createRateLimiter({ windowMs: 1000, max: 1 });
  assert.equal(check("ip1", 0), true);
  assert.equal(check("ip2", 0), true);
});

test("UUID_RE matches valid UUIDs and rejects path traversal attempts", () => {
  assert.equal(UUID_RE.test("0a5417a4-aebb-46e3-8423-f89eb69a3803"), true);
  assert.equal(UUID_RE.test("../../etc/passwd"), false);
  assert.equal(UUID_RE.test("not-a-uuid"), false);
});
