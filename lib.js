// Walks the text counting bracket depth (skipping over quoted strings so a `]`
// inside a value doesn't end a span early) and yields every top-level balanced
// `[...]` span in order — the model's prose can contain an unrelated bracket
// pair (an example, a format hint) before or after the real JSON array.
function* balancedArraySpans(text) {
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === "\\") escaped = true;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === "[") {
      if (depth === 0) start = i;
      depth++;
    } else if (c === "]" && depth > 0) {
      depth--;
      if (depth === 0) yield text.slice(start, i + 1);
    }
  }
}

export function extractJson(text) {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    // fall through
  }
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) return JSON.parse(fenced[1]);
  for (const span of balancedArraySpans(trimmed)) {
    try {
      return JSON.parse(span);
    } catch {
      // try the next candidate span
    }
  }
  throw new SyntaxError("no valid JSON array found in text");
}

const MAX_SUBTASKS = 5;

// Never trust the planner's shape or ids as-is: cap the fan-out (real API cost per
// subtask) and assign our own ids so a collision/duplicate from the model can't make
// two dashboard cards silently overwrite each other.
export function normalizeSubtasks(raw) {
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error("planner did not return a non-empty array of subtasks");
  }
  return raw.slice(0, MAX_SUBTASKS).map((t, i) => {
    const title = typeof t?.title === "string" && t.title.trim() ? t.title.trim() : `Subtask ${i + 1}`;
    const instructions = typeof t?.instructions === "string" ? t.instructions.trim() : "";
    if (!instructions) throw new Error(`subtask ${i + 1} is missing instructions`);
    return { id: `t${i}`, title, instructions };
  });
}

export function toMarkdown(run) {
  const sections = run.subtasks.map((t) => `### ${t.title}\n\n${t.output}`).join("\n\n");
  return `# ${run.goal}\n\n_${run.completedAt}_\n\n${sections}\n\n## Final Output\n\n${run.final}\n`;
}

// ponytail: fixed-window in-memory limiter, per-process only — move to Redis/DB if scaled to multiple instances
export function createRateLimiter({ windowMs, max, sweep = true }) {
  const hits = new Map(); // key -> { count, resetAt }
  if (sweep) {
    const timer = setInterval(() => {
      const now = Date.now();
      for (const [key, entry] of hits) if (now > entry.resetAt) hits.delete(key);
    }, windowMs);
    timer.unref?.();
  }
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

// Phase 2 paywall: a single shared code (from a members-only note post) bypasses the
// free-tier rate limit. No code configured (premiumCode falsy) means the feature is off.
export function isPremiumRequest(accessCode, premiumCode) {
  return Boolean(premiumCode) && accessCode === premiumCode;
}
