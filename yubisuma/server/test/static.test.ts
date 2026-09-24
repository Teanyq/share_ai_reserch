import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { gzipSync } from "node:zlib";
import { after, before, test } from "node:test";
import { startServer } from "../src/main.ts";

let server: ReturnType<typeof startServer>;
let base: string;

before(async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "yubisuma-public-"));
  mkdirSync(path.join(dir, "sub"));
  writeFileSync(path.join(dir, "index.html"), "<html>game</html>");
  writeFileSync(path.join(dir, "index.wasm.gz"), gzipSync(Buffer.from("WASMDATA")));
  server = startServer(0, {}, dir);
  await new Promise((r) => server.httpServer.once("listening", r));
  base = `http://127.0.0.1:${(server.httpServer.address() as AddressInfo).port}`;
});
after(() => server.close());

test("/ で Web 版の index.html を返す", async () => {
  const res = await fetch(`${base}/`);
  assert.equal(res.status, 200);
  assert.match(res.headers.get("content-type")!, /text\/html/);
  assert.equal(await res.text(), "<html>game</html>");
});

test("wasm は gzip のまま application/wasm で返す（fetch が自動展開）", async () => {
  const res = await fetch(`${base}/index.wasm`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/wasm");
  assert.equal(res.headers.get("content-encoding"), "gzip");
  assert.equal(await res.text(), "WASMDATA");
});

test("ETag が一致すれば 304", async () => {
  const first = await fetch(`${base}/index.html`);
  const res = await fetch(`${base}/index.html`, { headers: { "if-none-match": first.headers.get("etag")! } });
  assert.equal(res.status, 304);
});

test("ヘルスチェックと 404、ディレクトリ外は読めない", async () => {
  assert.equal((await fetch(`${base}/healthz`)).status, 200);
  assert.equal((await fetch(`${base}/nope.html`)).status, 404);
  assert.equal((await fetch(`${base}/..%2f..%2fetc%2fpasswd.html`)).status, 404);
});
