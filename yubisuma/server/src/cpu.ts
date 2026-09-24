// CPU プレイヤーの思考。
// Lv1: 完全ランダム / Lv2: 相手の出し方の履歴から最も出やすい合計をコール

export type CpuLevel = 1 | 2;

export interface CpuView {
  selfId: string;
  isCaller: boolean;
  /** 抜けていないプレイヤーの残り手（自分を含む） */
  hands: Record<string, number>;
  /** 各プレイヤーが過去に上げた親指の数（古い順） */
  history: Record<string, number[]>;
}

export interface CpuDecision {
  thumbs: number;
  call: number | null;
}

const randInt = (rng: () => number, max: number) => Math.floor(rng() * (max + 1));

export function decide(level: CpuLevel, v: CpuView, rng: () => number = Math.random): CpuDecision {
  const myHands = v.hands[v.selfId];
  const thumbs = randInt(rng, myHands);
  if (!v.isCaller) return { thumbs, call: null };

  const others = Object.keys(v.hands).filter((id) => id !== v.selfId);
  if (level === 1) {
    const othersMax = others.reduce((s, id) => s + v.hands[id], 0);
    return { thumbs, call: thumbs + randInt(rng, othersMax) };
  }

  // 相手ごとの出し方分布（ラプラス平滑化、直近 10 回を重視）を畳み込み、最頻の合計を狙う
  let dist = [1];
  for (const id of others) {
    const h = v.hands[id];
    const counts = Array.from({ length: h + 1 }, () => 1);
    for (const n of (v.history[id] ?? []).slice(-10)) counts[Math.min(n, h)] += 1;
    const sum = counts.reduce((a, b) => a + b, 0);
    const p = counts.map((c) => c / sum);
    const next = Array.from({ length: dist.length + h }, () => 0);
    dist.forEach((a, i) => p.forEach((b, j) => (next[i + j] += a * b)));
    dist = next;
  }
  const best = Math.max(...dist);
  const candidates = dist.flatMap((p, i) => (p >= best - 1e-9 ? [i] : []));
  return { thumbs, call: thumbs + candidates[randInt(rng, candidates.length - 1)] };
}
