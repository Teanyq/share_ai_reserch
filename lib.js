export function extractJson(text) {
  const match = text.match(/\[[\s\S]*\]/);
  return JSON.parse(match ? match[0] : text);
}

export function toMarkdown(run) {
  const sections = run.subtasks.map((t) => `### ${t.title}\n\n${t.output}`).join("\n\n");
  return `# ${run.goal}\n\n_${run.completedAt}_\n\n${sections}\n\n## Final Output\n\n${run.final}\n`;
}

// ponytail: fixed-window in-memory limiter, per-process only — move to Redis/DB if scaled to multiple instances
export function createRateLimiter({ windowMs, max }) {
  const hits = new Map(); // key -> { count, resetAt }
  return function check(key, now = Date.now()) {
    const entry = hits.get(key);
    if (!entry || now > entry.resetAt) {
      hits.set(key, { count: 1, resetAt: now + windowMs });
      return true;
    }
    if (entry.count >= max) return false;
    entry.count++;
    return true;
  };
}

export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
