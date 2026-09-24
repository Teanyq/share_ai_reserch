// Web 版クライアント（Godot の書き出し結果 = public/）を配信する。
// wasm は容量削減のため .gz だけを置いているので、gzip のまま返す（非対応クライアントには展開して返す）。

import { createReadStream, existsSync, statSync } from "node:fs";
import type http from "node:http";
import path from "node:path";
import { createGunzip } from "node:zlib";

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".wasm": "application/wasm",
  ".pck": "application/octet-stream",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

export function serveStatic(root: string, req: http.IncomingMessage, res: http.ServerResponse): boolean {
  if (req.method !== "GET" && req.method !== "HEAD") return false;
  let pathname: string;
  try {
    pathname = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname);
  } catch {
    return false;
  }
  if (pathname.endsWith("/")) pathname += "index.html";
  const file = path.join(root, pathname);
  if (!file.startsWith(root + path.sep)) return false; // ディレクトリトラバーサル防止

  const type = TYPES[path.extname(file)];
  if (!type) return false;
  const acceptsGzip = /\bgzip\b/.test(String(req.headers["accept-encoding"] ?? ""));
  const gz = `${file}.gz`;
  const useGz = existsSync(gz) && (acceptsGzip || !existsSync(file));
  const source = useGz ? gz : file;
  if (!existsSync(source) || !statSync(source).isFile()) return false;

  const st = statSync(source);
  const etag = `"${st.size.toString(36)}-${Math.floor(st.mtimeMs).toString(36)}${useGz && acceptsGzip ? "-gz" : ""}"`;
  const headers: http.OutgoingHttpHeaders = {
    "content-type": type,
    "cache-control": "no-cache",
    etag,
    vary: "accept-encoding",
  };
  if (req.headers["if-none-match"] === etag) {
    res.writeHead(304, headers);
    res.end();
    return true;
  }
  if (useGz && acceptsGzip) {
    headers["content-encoding"] = "gzip";
    headers["content-length"] = st.size;
  } else if (!useGz) {
    headers["content-length"] = st.size;
  }
  res.writeHead(200, headers);
  if (req.method === "HEAD") {
    res.end();
    return true;
  }
  const stream = createReadStream(source);
  (useGz && !acceptsGzip ? stream.pipe(createGunzip()) : stream).pipe(res);
  return true;
}
