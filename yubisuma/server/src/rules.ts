// 指スマのルールエンジン。副作用なしの純粋関数のみ（サーバ・CPU・テストで共用）。

export interface RuleConfig {
  startHands: number;
  /** このラウンド数を消化したらサドンデス突入 */
  suddenDeathRound: number;
  /** サドンデス中に当てたとき減る手の数 */
  suddenDeathHandLoss: number;
  /** サドンデス突入後、このラウンド数で強制決着 */
  suddenDeathMaxRounds: number;
}

export const defaultRuleConfig = (playerCount: number): RuleConfig => ({
  startHands: 2,
  suddenDeathRound: playerCount >= 4 ? 24 : 30,
  suddenDeathHandLoss: 2,
  suddenDeathMaxRounds: 20,
});

export interface PlayerState {
  id: string;
  hands: number;
  hits: number;
}

export interface GameState {
  config: RuleConfig;
  /** 席順 */
  players: PlayerState[];
  callerIndex: number;
  /** 消化済みラウンド数 */
  round: number;
  suddenDeath: boolean;
  /** 抜けた順（1位から）。決着時は最下位まで全員入る */
  placements: string[];
  over: boolean;
  /** 強制決着（ラウンド上限）で終わったか */
  timedOut: boolean;
}

export interface RoundResult {
  callerId: string;
  call: number | null;
  thumbs: Record<string, number>;
  total: number;
  hit: boolean;
  /** このラウンドで抜けたプレイヤー */
  finished: string[];
}

export function createGame(playerIds: string[], config: RuleConfig, firstCallerIndex = 0): GameState {
  if (playerIds.length < 2) throw new Error("2人以上必要です");
  return {
    config,
    players: playerIds.map((id) => ({ id, hands: config.startHands, hits: 0 })),
    callerIndex: firstCallerIndex % playerIds.length,
    round: 0,
    suddenDeath: false,
    placements: [],
    over: false,
    timedOut: false,
  };
}

export const activePlayers = (s: GameState): PlayerState[] => s.players.filter((p) => p.hands > 0);

export const currentCaller = (s: GameState): PlayerState => s.players[s.callerIndex];

/** コールできる数字の範囲 [0, max] */
export const callRange = (s: GameState): [number, number] => [
  0,
  activePlayers(s).reduce((sum, p) => sum + p.hands, 0),
];

export const clampThumbs = (n: unknown, hands: number): number =>
  typeof n === "number" && Number.isInteger(n) ? Math.min(Math.max(n, 0), hands) : 0;

/**
 * 1ラウンドを解決する。
 * @param thumbs 各プレイヤーが上げた親指の数（未指定・範囲外は補正）
 * @param call コーラーの宣言。null は未入力（必ずハズレ）
 */
export function resolveRound(
  s: GameState,
  thumbs: Record<string, number>,
  call: number | null,
): { state: GameState; result: RoundResult } {
  if (s.over) throw new Error("ゲームは終了しています");
  const players = s.players.map((p) => ({ ...p }));
  const caller = players[s.callerIndex];

  const shown: Record<string, number> = {};
  let total = 0;
  for (const p of players) {
    if (p.hands === 0) continue;
    shown[p.id] = clampThumbs(thumbs[p.id], p.hands);
    total += shown[p.id];
  }
  const [, max] = callRange(s);
  const validCall = call !== null && Number.isInteger(call) && call >= 0 && call <= max ? call : null;
  const hit = validCall !== null && validCall === total;

  const placements = [...s.placements];
  const finished: string[] = [];
  if (hit) {
    caller.hits += 1;
    caller.hands = Math.max(0, caller.hands - (s.suddenDeath ? s.config.suddenDeathHandLoss : 1));
    if (caller.hands === 0) {
      placements.push(caller.id);
      finished.push(caller.id);
    }
  }

  const round = s.round + 1;
  let over = false;
  let timedOut = false;
  const remaining = players.filter((p) => p.hands > 0);
  if (remaining.length <= 1) {
    over = true;
    placements.push(...remaining.map((p) => p.id));
  } else if (round >= s.config.suddenDeathRound + s.config.suddenDeathMaxRounds) {
    // 強制決着：残り手が少ない順 → 当てた回数が多い順 → 席順
    over = true;
    timedOut = true;
    const ranked = [...remaining].sort((a, b) => a.hands - b.hands || b.hits - a.hits);
    placements.push(...ranked.map((p) => p.id));
  }

  const state: GameState = {
    ...s,
    players,
    round,
    placements,
    over,
    timedOut,
    suddenDeath: s.suddenDeath || round >= s.config.suddenDeathRound,
    callerIndex: over ? s.callerIndex : nextCallerIndex(players, s.callerIndex),
  };
  return { state, result: { callerId: caller.id, call: validCall, thumbs: shown, total, hit, finished } };
}

function nextCallerIndex(players: PlayerState[], from: number): number {
  for (let i = 1; i <= players.length; i++) {
    const idx = (from + i) % players.length;
    if (players[idx].hands > 0) return idx;
  }
  return from;
}
