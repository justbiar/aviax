export type Candle = { ts: number; o: number; h: number; l: number; c: number; v: number };

export type Features = {
  instId: string;
  last: number;
  chg24h: number; // %
  ret1h: number; // %
  ret4h: number; // %
  rsi: number;
  atr: number; // absolute
  atrPct: number; // %
  ema20: number;
  ema50: number;
  trend: number; // (ema20-ema50)/ema50 in %
  volZ: number; // last-hour volume z-score
  funding: number; // % per 8h
  signal: number; // -1..1 combined directional bias
  spark: number[]; // last 48 closes for sparkline
};

/** OKX candles come newest first as string arrays. */
export const parseCandles = (rows: string[][]): Candle[] =>
  rows
    .map((r) => ({ ts: +r[0], o: +r[1], h: +r[2], l: +r[3], c: +r[4], v: +r[5] }))
    .sort((a, b) => a.ts - b.ts);

const ema = (xs: number[], n: number) => {
  const k = 2 / (n + 1);
  let e = xs[0];
  for (const x of xs) e = x * k + e * (1 - k);
  return e;
};

function rsi(closes: number[], n = 14) {
  let gain = 0;
  let loss = 0;
  for (let i = closes.length - n; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) gain += d;
    else loss -= d;
  }
  if (loss === 0) return 100;
  return 100 - 100 / (1 + gain / loss);
}

function atr(cs: Candle[], n = 14) {
  let s = 0;
  for (let i = cs.length - n; i < cs.length; i++) {
    const p = cs[i - 1].c;
    s += Math.max(cs[i].h - cs[i].l, Math.abs(cs[i].h - p), Math.abs(cs[i].l - p));
  }
  return s / n;
}

/** Features from 1H candles (>= 100 bars). */
export function computeFeatures(instId: string, cs: Candle[], open24h: number, funding = 0): Features {
  const closes = cs.map((c) => c.c);
  const last = closes[closes.length - 1];
  const at = (barsAgo: number) => closes[Math.max(0, closes.length - 1 - barsAgo)];
  const e20 = ema(closes, 20);
  const e50 = ema(closes, 50);
  const a = atr(cs);
  const vols = cs.slice(-72).map((c) => c.v);
  const mean = vols.reduce((s, v) => s + v, 0) / vols.length;
  const sd = Math.sqrt(vols.reduce((s, v) => s + (v - mean) ** 2, 0) / vols.length) || 1;
  const lastHourVol = cs[cs.length - 1].v;
  const r = rsi(closes);
  const trend = ((e20 - e50) / e50) * 100;
  const ret4h = (last / at(4) - 1) * 100;
  const atrPct = (a / last) * 100;

  // Directional bias: trend and momentum normalised by volatility, faded at RSI extremes.
  const tz = Math.tanh(trend / Math.max(atrPct, 0.05));
  const mz = Math.tanh(ret4h / Math.max(atrPct * 2, 0.2));
  const rsiFade = r > 72 ? -(r - 72) / 28 : r < 28 ? (28 - r) / 28 : 0;
  const fundFade = -Math.tanh(funding * 30);
  const signal = Math.max(-1, Math.min(1, 0.45 * tz + 0.35 * mz + 0.12 * rsiFade + 0.08 * fundFade));

  return {
    instId,
    last,
    chg24h: (last / open24h - 1) * 100,
    ret1h: (last / at(1) - 1) * 100,
    ret4h,
    rsi: r,
    atr: a,
    atrPct,
    ema20: e20,
    ema50: e50,
    trend,
    volZ: (lastHourVol - mean) / sd,
    funding,
    signal,
    spark: closes.slice(-48),
  };
}

const f = (n: number, d = 2) => (n >= 0 ? "+" : "") + n.toFixed(d);

/** Plain-language market state handed to the decision models. */
export function describe(x: Features) {
  return [
    `${x.instId} perpetual at ${x.last}.`,
    `24h change ${f(x.chg24h)}%, 4h ${f(x.ret4h)}%, 1h ${f(x.ret1h)}%.`,
    `EMA20 is ${x.trend >= 0 ? "above" : "below"} EMA50 by ${Math.abs(x.trend).toFixed(2)}%.`,
    `RSI(14, 1H) ${x.rsi.toFixed(1)}. 1H ATR ${x.atrPct.toFixed(2)}% of price.`,
    `Volume z-score ${f(x.volZ, 1)}. Funding ${f(x.funding, 4)}% per 8h.`,
  ].join(" ");
}
