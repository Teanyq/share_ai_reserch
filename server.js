import { existsSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import express from "express";
import { WebSocketServer } from "ws";
import Anthropic from "@anthropic-ai/sdk";
import { extractJson, toMarkdown, createRateLimiter, UUID_RE } from "./lib.js";

if (existsSync(".env")) process.loadEnvFile(".env");

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, maxRetries: 5 });

const DATA_DIR = path.join(process.cwd(), "data");
mkdirSync(DATA_DIR, { recursive: true });

const app = express();
app.use(express.json());
app.use(express.static("public"));

const server = app.listen(process.env.PORT || 3300, () =>
  console.log(`AI orchestration dashboard: http://localhost:${server.address().port}`)
);

const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});
function broadcast(event) {
  const msg = JSON.stringify(event);
  for (const ws of clients) if (ws.readyState === 1) ws.send(msg);
}

async function askClaude(system, prompt) {
  const res = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 1500,
    system,
    messages: [{ role: "user", content: prompt }],
  });
  return res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
}

const RATE_LIMIT = { windowMs: 60 * 60 * 1000, max: 10 };
const checkRateLimit = createRateLimiter(RATE_LIMIT);

async function runOrchestration(runId, goal) {
  broadcast({ type: "run:start", runId, goal });

  let subtasks;
  try {
    const planRaw = await askClaude(
      "You split a user's goal into 2-5 independent subtasks for parallel agents. " +
        'Respond with ONLY a JSON array like [{"id":"a1","title":"...","instructions":"..."}]. No prose.',
      goal
    );
    subtasks = extractJson(planRaw);
  } catch (err) {
    broadcast({ type: "run:error", runId, message: `Planning failed: ${err.message}` });
    return;
  }

  broadcast({ type: "plan:ready", runId, subtasks });

  const results = await Promise.all(
    subtasks.map(async (task) => {
      broadcast({ type: "agent:start", runId, id: task.id, title: task.title });
      try {
        const output = await askClaude(
          "You are a focused sub-agent. Complete only the given instructions concisely.",
          task.instructions
        );
        broadcast({ type: "agent:done", runId, id: task.id, output });
        return { ...task, output };
      } catch (err) {
        broadcast({ type: "agent:error", runId, id: task.id, message: err.message });
        return { ...task, output: `[error: ${err.message}]` };
      }
    })
  );

  broadcast({ type: "synthesis:start", runId });
  try {
    const summary = results.map((r) => `### ${r.title}\n${r.output}`).join("\n\n");
    const final = await askClaude(
      "Combine the sub-agent results into one clear final answer for the user's original goal.",
      `Goal: ${goal}\n\nSub-agent results:\n${summary}`
    );
    broadcast({ type: "run:complete", runId, final });
    writeFileSync(
      path.join(DATA_DIR, `${runId}.json`),
      JSON.stringify({ runId, goal, subtasks: results, final, completedAt: new Date().toISOString() })
    );
  } catch (err) {
    broadcast({ type: "run:error", runId, message: `Synthesis failed: ${err.message}` });
  }
}

function loadRun(runId) {
  const file = path.join(DATA_DIR, `${runId}.json`);
  if (!existsSync(file)) return null;
  return JSON.parse(readFileSync(file, "utf8"));
}

app.get("/api/runs/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).json({ error: "invalid id" });
  const run = loadRun(req.params.id);
  if (!run) return res.status(404).json({ error: "not found" });
  res.json(run);
});

app.get("/api/runs/:id/markdown", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).send("invalid id");
  const run = loadRun(req.params.id);
  if (!run) return res.status(404).send("not found");
  res.set("Content-Type", "text/markdown; charset=utf-8");
  res.set("Content-Disposition", `attachment; filename="${req.params.id}.md"`);
  res.send(toMarkdown(run));
});

app.get("/r/:id", (req, res) => {
  if (!UUID_RE.test(req.params.id)) return res.status(400).send("invalid id");
  res.sendFile(path.join(process.cwd(), "public", "share.html"));
});

app.post("/api/run", (req, res) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(400).json({ error: "ANTHROPIC_API_KEY is not set (create a .env file)" });
  }
  if (!checkRateLimit(req.ip)) {
    return res.status(429).json({ error: `1時間あたり${RATE_LIMIT.max}回までです。しばらくしてから再度お試しください` });
  }
  const goal = (req.body.goal || "").trim();
  if (!goal) return res.status(400).json({ error: "goal is required" });
  if (goal.length > 500) return res.status(400).json({ error: "goal must be 500 characters or fewer" });

  const runId = randomUUID();
  res.json({ runId });
  runOrchestration(runId, goal).catch((err) =>
    broadcast({ type: "run:error", runId, message: err.message })
  );
});
