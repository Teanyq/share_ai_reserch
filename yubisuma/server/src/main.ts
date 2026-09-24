// エントリポイント：HTTP（ヘルスチェック）+ WebSocket(/ws)

import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { WebSocketServer, type WebSocket } from "ws";
import { Hub, type HubOptions } from "./hub.ts";

export const PROTOCOL_VERSION = 1;

export function startServer(port: number, hubOpts: HubOptions = {}) {
  const hub = new Hub(hubOpts);
  const httpServer = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    res.end(`yubisuma server ok (protocol v${PROTOCOL_VERSION})\n`);
  });
  const wss = new WebSocketServer({ server: httpServer, path: "/ws", maxPayload: 4 * 1024 });
  const alive = new WeakMap<WebSocket, boolean>();

  wss.on("connection", (ws) => {
    let playerId: string | null = null;
    let windowStart = Date.now();
    let count = 0;
    alive.set(ws, true);
    const conn = {
      send: (msg: object) => {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ v: PROTOCOL_VERSION, ...msg }));
      },
      close: () => ws.close(),
    };
    ws.on("pong", () => alive.set(ws, true));
    ws.on("message", (data) => {
      // 簡易レート制限：1 秒に 40 メッセージまで
      const now = Date.now();
      if (now - windowStart > 1000) {
        windowStart = now;
        count = 0;
      }
      if (++count > 40) return;
      let msg: unknown;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return conn.send({ type: "error", message: "invalid JSON" });
      }
      playerId = hub.handle(conn, playerId, msg);
    });
    ws.on("close", () => hub.disconnected(conn, playerId));
  });

  const tick = setInterval(() => hub.tick(), 1000);
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!alive.get(ws)) {
        ws.terminate();
        continue;
      }
      alive.set(ws, false);
      ws.ping();
    }
  }, 15000);

  httpServer.listen(port);
  return {
    httpServer,
    hub,
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(tick);
        clearInterval(heartbeat);
        hub.stop();
        for (const ws of wss.clients) ws.terminate();
        wss.close();
        httpServer.close(() => resolve());
      }),
  };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 8787);
  const { httpServer } = startServer(port, {
    dataFile: path.join(process.cwd(), "data", "profiles.json"),
    casualCpuFillMs: Number(process.env.CASUAL_CPU_FILL_MS ?? 20000),
    // DEV_FAST=1: 動作確認用に演出と入力時間を短縮
    ...(process.env.DEV_FAST === "1"
      ? { roomDeps: { timings: { announceMs: 100, revealMs: 300, gameEndMs: 500 } }, forceSettings: { inputMs: 600 } }
      : {}),
  });
  httpServer.on("listening", () => console.log(`yubisuma server: ws://localhost:${port}/ws`));
}
