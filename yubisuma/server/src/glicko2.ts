// Glicko-2（Glickman, 2012）。1 試合ずつ更新する簡易版。

export interface Rating {
  rating: number;
  rd: number;
  vol: number;
}

export const initialRating = (): Rating => ({ rating: 1500, rd: 350, vol: 0.06 });

const SCALE = 173.7178;
const TAU = 0.5;

const g = (phi: number) => 1 / Math.sqrt(1 + (3 * phi * phi) / (Math.PI * Math.PI));

/** score: 1 = 勝ち, 0 = 負け, 0.5 = 引き分け */
export function update(player: Rating, opponent: Rating, score: number): Rating {
  const mu = (player.rating - 1500) / SCALE;
  const phi = player.rd / SCALE;
  const muJ = (opponent.rating - 1500) / SCALE;
  const phiJ = opponent.rd / SCALE;

  const gJ = g(phiJ);
  const e = 1 / (1 + Math.exp(-gJ * (mu - muJ)));
  const v = 1 / (gJ * gJ * e * (1 - e));
  const delta = v * gJ * (score - e);

  // 変動率 σ' を Illinois 法で求める
  const a = Math.log(player.vol * player.vol);
  const f = (x: number) => {
    const ex = Math.exp(x);
    return (ex * (delta * delta - phi * phi - v - ex)) / (2 * (phi * phi + v + ex) ** 2) - (x - a) / (TAU * TAU);
  };
  let A = a;
  let B: number;
  if (delta * delta > phi * phi + v) {
    B = Math.log(delta * delta - phi * phi - v);
  } else {
    let k = 1;
    while (f(a - k * TAU) < 0) k++;
    B = a - k * TAU;
  }
  let fA = f(A);
  let fB = f(B);
  while (Math.abs(B - A) > 1e-6) {
    const C = A + ((A - B) * fA) / (fB - fA);
    const fC = f(C);
    if (fC * fB <= 0) {
      A = B;
      fA = fB;
    } else {
      fA /= 2;
    }
    B = C;
    fB = fC;
  }
  const vol = Math.exp(A / 2);

  const phiStar = Math.sqrt(phi * phi + vol * vol);
  const phiNew = 1 / Math.sqrt(1 / (phiStar * phiStar) + 1 / v);
  const muNew = mu + phiNew * phiNew * gJ * (score - e);
  return { rating: muNew * SCALE + 1500, rd: Math.min(phiNew * SCALE, 350), vol };
}

/** 表示用の保守的レート（rating - 2RD） */
export const displayRating = (r: Rating) => Math.round(r.rating - 2 * r.rd);

const TIERS = ["ブロンズ", "シルバー", "ゴールド", "プラチナ", "ダイヤ"] as const;

export function tierName(display: number, rankedGames: number): string {
  if (rankedGames < 5) return `配置戦 ${rankedGames}/5`;
  if (display >= 2100) return "マスター";
  // 〜1300 ブロンズ, 以降 200 刻み。各ティアを III→I の 3 段に分割
  const idx = display < 1300 ? 0 : Math.min(4, Math.floor((display - 1300) / 200) + 1);
  const lower = idx === 0 ? -Infinity : 1300 + (idx - 1) * 200;
  const step = idx === 0 ? Math.max(0, Math.min(2, Math.floor((display - 1100) / 67))) : Math.floor((display - lower) / 67);
  return `${TIERS[idx]} ${["III", "II", "I"][Math.min(2, Math.max(0, step))]}`;
}
