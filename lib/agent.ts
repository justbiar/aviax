import { atkCall, atkData } from "./atk";
import { decide as decideRaw, isLive, resolveSpec, type Answer, type DecisionResult, type ModelName, type ModelSpec, type Provider, type Question } from "./decide";
import { computeFeatures, describe, parseCandles, type Features } from "./features";
import { getOrder, hasOkxKeys, roundLot, roundToTick } from "./okx";
import { hasOpenRouter, narrate } from "./openrouter";

export type Stage = "scan" | "features" | "workers" | "pair" | "direction" | "size" | "risk" | "gate" | "execute" | "monitor";

export type AgentEvent =
  | { type: "hello"; at: number; live: { jev: boolean; laya: boolean; okx: boolean; llm: boolean }; providers: { jev: Provider; laya: Provider }; jevModel: string; execute: boolean }
  | { type: "stage"; stage: Stage; status: "start" | "done" | "skip" | "fail"; note?: string }
  | { type: "log"; text: string; tool?: string; tone?: "info" | "jev" | "laya" | "ok" | "warn" | "err" | "llm" }
  | { type: "universe"; pairs: Features[] }
  | { type: "worker"; instId: string; jev: DecisionResult; laya: DecisionResult; edge: number }
  | { type: "decision"; key: "pair" | "direction" | "size" | "leverage" | "tp" | "sl" | "gate"; title: string; jev: Answer; laya: Answer; jevMs: number; layaMs: number; jevSrc: string; jevProvider: Provider; pick: string; labels?: Record<string, string> }
  | { type: "plan"; plan: Plan }
  | { type: "order"; ok: boolean; detail: string; ordId?: string; algoId?: string; qty?: string; avgPx?: number }
  | { type: "narration"; text: string }
  | { type: "done"; ms: number; verdict: "executed" | "planned" | "hold" | "error" };

export type Plan = {
  instId: string;
  side: "long";
  entry: number;
  tp: number;
  sl: number;
  tpAtr: number;
  slAtr: number;
  notional: number;
  /** Spot: base-currency quantity (estimated before the fill, exact after). */
  contracts: string;
  leverage: number; // always 1 on spot
  rr: number;
  confidence: number;
  gate: number;
};

const SYS =
  "You are the narrator of an autonomous trading agent. Decision models (JEV, LAYA) return probability distributions, you only explain them. Write in Turkish, 2 to 3 short sentences, concrete numbers, no hype, no emojis, never use em dashes.";

/** Crypto-native spot pairs only (OKX also lists tokenised stocks). */
const CRYPTO = new Set("BTC ETH SOL XRP DOGE BNB ADA AVAX LINK SUI TON LTC ZEC PEPE TRX DOT BCH UNI NEAR APT ARB OP WIF HYPE ENA AAVE ETC FIL ATOM INJ TIA SEI WLD ONDO TRUMP SHIB XLM HBAR ICP RENDER FET PENGU BONK CRV LDO JUP PUMP".split(" "));

const MAX_NOTIONAL = () => Number(process.env.AGENT_MAX_NOTIONAL_USDT || 500);
const base = (instId: string) => instId.split("-")[0];
const pct = (p: number) => `${(p * 100).toFixed(0)}%`;

/** Average two distributions (ensemble), JEV weighted slightly higher. */
function blend(a: Answer, b: Answer, wa = 0.6) {
  const keys = Object.keys(a.probabilities);
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = wa * a.probabilities[k] + (1 - wa) * (b.probabilities[k] ?? 0);
  return out;
}
const top = (p: Record<string, number>) => Object.entries(p).sort((x, y) => y[1] - x[1])[0];

export type RunOpts = {
  execute: boolean;
  universe?: number;
  /** JEV model for this agent, e.g. "openrouter:liquid/lfm-2.5-2.6b:free" or "ollama:strands-decider". */
  model?: ModelSpec;
  /** Margin capital the agent may commit (USDT). Defaults to env max notional. */
  budget?: number;
  maxLeverage?: number;
  /** Instruments held by other agents; never traded here. */
  exclude?: string[];
  /** Fleet mode: abort the cycle instead of falling back to shadow when JEV is unreachable. */
  strict?: boolean;
  /** clOrdId prefix so fills can be attributed to an agent. */
  tag?: string;
};

export async function* runAgent(opts: RunOpts): AsyncGenerator<AgentEvent> {
  const t0 = Date.now();
  const execute = opts.execute && hasOkxKeys();
  const decide = async (m: ModelName, state: string, qs: Record<string, Question>) => {
    const r = await decideRaw(m, state, qs, m === "jev" ? opts.model : undefined);
    if (opts.strict && m === "jev" && r.error) throw new Error(`JEV modeli cevap vermedi (${r.error.slice(0, 120)}). Bu tur atlandı.`);
    return r;
  };
  const provider = (m: ModelName) => resolveSpec(m, m === "jev" ? opts.model : undefined).prov;
  const jevSpec = resolveSpec("jev", opts.model);
  const jevProv = jevSpec.prov;
  yield {
    type: "hello",
    at: t0,
    live: { jev: isLive("jev"), laya: isLive("laya"), okx: hasOkxKeys(), llm: hasOpenRouter() },
    providers: { jev: jevProv, laya: provider("laya") },
    jevModel: jevProv === "shadow" ? "shadow" : jevSpec.modelId,
    execute,
  };
  if (opts.execute && !hasOkxKeys()) yield { type: "log", tone: "warn", text: "OKX anahtarı yok: plan modu, emir gönderilmeyecek." };

  /* 1. SCAN ------------------------------------------------------------ */
  yield { type: "stage", stage: "scan", status: "start" };
  yield { type: "log", tool: "market_get_tickers", text: "ATK → USDT spot piyasasını tarıyor" };
  type T = { instId: string; last: string; open24h: string; volCcy24h: string };
  const tickers = atkData<T>(await atkCall("market_get_tickers", { instType: "SPOT" }));
  const n = opts.universe ?? 6;
  const liquid = tickers
    .filter((t) => t.instId.endsWith("-USDT") && CRYPTO.has(base(t.instId)) && !opts.exclude?.includes(t.instId))
    // spot volCcy24h is already quoted in USDT
    .map((t) => ({ ...t, qv: Number(t.volCcy24h) }))
    .sort((a, b) => b.qv - a.qv);
  // AVAX always competes: the agent is built for the Avalanche ecosystem.
  const avax = liquid.find((t) => t.instId === "AVAX-USDT");
  const ranked = [...liquid.filter((t) => t !== avax).slice(0, avax ? n - 1 : n), ...(avax ? [avax] : [])];
  yield { type: "log", tone: "ok", text: `${tickers.length} spot parite tarandı, hacme göre ilk ${n}: ${ranked.map((r) => base(r.instId)).join(", ")}` };
  yield { type: "stage", stage: "scan", status: "done" };

  /* 2. FEATURES -------------------------------------------------------- */
  yield { type: "stage", stage: "features", status: "start" };
  const pairs: Features[] = await Promise.all(
    ranked.map(async (t) => {
      const c = await atkCall("market_get_candles", { instId: t.instId, bar: "1H", limit: 120 });
      return computeFeatures(t.instId, parseCandles(atkData<string[]>(c)), Number(t.open24h), 0);
    }),
  );
  yield { type: "log", tool: "market_get_candles", text: `${pairs.length} ATK çağrısı paralel: 1H mumlar` };
  yield { type: "universe", pairs };
  yield { type: "stage", stage: "features", status: "done" };

  const brief = narrate(SYS, `Piyasa özeti çıkar:\n${pairs.map(describe).join("\n")}`);

  /* 3. PARALLEL WORKERS: one JEV + one LAYA forward pass per pair --------- */
  yield { type: "stage", stage: "workers", status: "start" };
  yield { type: "log", tone: "jev", text: `${pairs.length} worker başlatıldı. Her worker JEV ve LAYA'ya aynı state'i soruyor.` };
  const workerQs = (x: Features): Record<string, Question> => ({
    direction: {
      type: "choice",
      instructions: "Spot only, no shorting. Does buying now have positive expected value over the next 4 hours, or is holding USDT better?",
      criteria: { long: "Buy the asset now", flat: "Stay in USDT, no edge" },
      prior: { long: 1.6 * x.signal, flat: 0.15 - 1.0 * x.signal },
    },
    quality: {
      type: "score",
      instructions: "How clean and tradable is this setup?",
      criteria: ["Untradable", "Weak", "Average", "Good", "Excellent"],
      prior: [0, 1, 2, 3, 4].map((i) => -Math.abs(i - (1 + 3 * Math.abs(x.signal) - Math.max(0, x.atrPct - 1.5))) * 0.9),
    },
  });
  // LLM-backed providers are slow and rate limited: one batched request covers every pair.
  const askWorkers = async (m: ModelName): Promise<DecisionResult[]> => {
    if (provider(m) !== "openrouter") return Promise.all(pairs.map((x) => decide(m, describe(x), workerQs(x))));
    const qs: Record<string, Question> = {};
    for (const x of pairs) {
      const tag = base(x.instId);
      for (const [k, q] of Object.entries(workerQs(x))) qs[`${tag}__${k}`] = { ...q, instructions: `[${x.instId}] ${q.instructions}` };
    }
    const r = await decide(m, pairs.map(describe).join("\n"), qs);
    return pairs.map((x) => {
      const tag = base(x.instId);
      return { ...r, answers: { direction: r.answers[`${tag}__direction`], quality: r.answers[`${tag}__quality`] } };
    });
  };
  const [jevW, layaW] = await Promise.all([askWorkers("jev"), askWorkers("laya")]);
  const workers = pairs.map((x, i) => {
    const j = jevW[i];
    const l = layaW[i];
    const dir = blend(j.answers.direction, l.answers.direction);
    const q = (0.6 * (j.answers.quality.score ?? 2) + 0.4 * (l.answers.quality.score ?? 2)) / 4;
    const edge = dir.long * (0.5 + q) - dir.flat * 0.5;
    return { x, j, l, edge };
  });
  const wErr = workers.find((w) => w.j.error)?.j.error;
  if (wErr) yield { type: "log", tone: "warn", text: `JEV canlı çağrı hatası, shadow'a düştü: ${wErr}` };
  for (const w of workers) {
    yield { type: "worker", instId: w.x.instId, jev: w.j, laya: w.l, edge: w.edge };
    const d = w.j.answers.direction.probabilities;
    yield { type: "log", tone: "jev", text: `${base(w.x.instId)} · JEV ${w.j.latencyMs}ms AL ${pct(d.long)} BEKLE ${pct(d.flat)} · LAYA ${w.l.latencyMs}ms` };
  }
  yield { type: "stage", stage: "workers", status: "done" };

  /* 4. PAIR: single choice across all candidates ----------------------- */
  yield { type: "stage", stage: "pair", status: "start" };
  const criteria = Object.fromEntries(workers.map((w) => [w.x.instId, describe(w.x)]));
  const pairPrior = Object.fromEntries(workers.map((w) => [w.x.instId, w.edge * 3]));
  const pairQ: Record<string, Question> = { pair: { type: "choice", instructions: "Which instrument offers the best risk-adjusted opportunity right now?", criteria, prior: pairPrior } };
  const universeState = `Candidate spot pairs (long only) ranked by 24h liquidity. ${workers.map((w) => describe(w.x)).join(" ")}`;
  const [pj, pl] = await Promise.all([decide("jev", universeState, pairQ), decide("laya", universeState, pairQ)]);
  const pairDist = blend(pj.answers.pair, pl.answers.pair);
  const [instId, pairP] = top(pairDist);
  const chosen = workers.find((w) => w.x.instId === instId)!;
  const x = chosen.x;
  yield { type: "decision", key: "pair", title: "Parite seçimi", jev: pj.answers.pair, laya: pl.answers.pair, jevMs: pj.latencyMs, jevSrc: pj.modelId, jevProvider: pj.provider, layaMs: pl.latencyMs, pick: instId };
  yield { type: "log", tone: "ok", text: `Parite: ${instId} (ensemble p=${pct(pairP)})` };
  yield { type: "stage", stage: "pair", status: "done" };

  /* 5. DIRECTION (reuse the chosen worker's distributions) -------------- */
  yield { type: "stage", stage: "direction", status: "start" };
  const dirDist = blend(chosen.j.answers.direction, chosen.l.answers.direction);
  const [dirKey, dirP] = top(dirDist);
  yield { type: "decision", key: "direction", title: "İşlem yönü", jev: chosen.j.answers.direction, laya: chosen.l.answers.direction, jevMs: chosen.j.latencyMs, jevSrc: chosen.j.modelId, jevProvider: chosen.j.provider, layaMs: chosen.l.latencyMs, pick: dirKey };
  yield { type: "stage", stage: "direction", status: "done" };

  if (dirKey === "flat") {
    yield { type: "log", tone: "warn", text: `En olası sonuç BEKLE (${pct(dirP)}). Agent USDT'de kalıyor.` };
    for (const s of ["size", "risk", "gate", "execute"] as Stage[]) yield { type: "stage", stage: s, status: "skip" };
    const b = await brief;
    if (b) yield { type: "narration", text: b };
    yield { type: "done", ms: Date.now() - t0, verdict: "hold" };
    return;
  }
  const side = "long" as const;
  const state = describe(x) + ` Proposed action: spot buy. Model confidence ${pct(dirP)}.`;

  /* 6. SIZE (spot: no leverage, the budget is the cap) ------------------ */
  yield { type: "stage", stage: "size", status: "start" };
  const sizeLevels = ["Minimal", "Small", "Medium", "Large", "Max"];
  const conf = (dirP - 0.5) / 0.5;
  const sizeTarget = 4 * conf - Math.max(0, x.atrPct - 1) * 1.5;
  const sizeQ: Record<string, Question> = {
    size: { type: "score", instructions: "How much of the budget should this spot buy use?", criteria: sizeLevels, prior: sizeLevels.map((_, i) => -Math.abs(i - sizeTarget)) },
  };
  const [sj, sl] = await Promise.all([decide("jev", state, sizeQ), decide("laya", state, sizeQ)]);
  const sizeScore = 0.6 * (sj.answers.size.score ?? 1) + 0.4 * (sl.answers.size.score ?? 1);
  const leverage = 1;
  const sizeFrac = 0.2 + 0.8 * (sizeScore / 4); // share of the budget spent on this buy
  const notional = opts.budget ? Math.max(5, Math.floor(opts.budget * sizeFrac)) : Math.round(MAX_NOTIONAL() * sizeFrac);
  yield { type: "decision", key: "size", title: "Alım tutarı", jev: sj.answers.size, laya: sl.answers.size, jevMs: sj.latencyMs, jevSrc: sj.modelId, jevProvider: sj.provider, layaMs: sl.latencyMs, pick: `${notional} USDT` };
  yield { type: "stage", stage: "size", status: "done" };

  /* 7. TP / SL as distributions over ATR multiples -------------------- */
  yield { type: "stage", stage: "risk", status: "start" };
  const tpOpts = { tp_1: 1, tp_1_5: 1.5, tp_2: 2, tp_3: 3 } as const;
  const slOpts = { sl_0_75: 0.75, sl_1: 1, sl_1_5: 1.5, sl_2: 2 } as const;
  const trendStrength = Math.abs(x.trend) / Math.max(x.atrPct, 0.05);
  const riskQ: Record<string, Question> = {
    tp: {
      type: "choice",
      instructions: `Where should take-profit sit for this ${side}, measured in ATR from entry?`,
      criteria: Object.fromEntries(Object.entries(tpOpts).map(([k, v]) => [k, `${v} ATR from entry`])),
      prior: Object.fromEntries(Object.entries(tpOpts).map(([k, v]) => [k, -Math.abs(v - (1.2 + trendStrength * 1.2))])),
    },
    sl: {
      type: "choice",
      instructions: `Where should stop-loss sit for this ${side}, measured in ATR from entry?`,
      criteria: Object.fromEntries(Object.entries(slOpts).map(([k, v]) => [k, `${v} ATR from entry`])),
      prior: Object.fromEntries(Object.entries(slOpts).map(([k, v]) => [k, -Math.abs(v - (0.8 + Math.max(0, x.volZ) * 0.25 + x.atrPct * 0.2)) * 1.5])),
    },
  };
  const [rj, rl] = await Promise.all([decide("jev", state, riskQ), decide("laya", state, riskQ)]);
  const tpKey = top(blend(rj.answers.tp, rl.answers.tp))[0] as keyof typeof tpOpts;
  const slKey = top(blend(rj.answers.sl, rl.answers.sl))[0] as keyof typeof slOpts;
  const tpAtr = tpOpts[tpKey];
  const slAtr = slOpts[slKey];
  const dirSign = side === "long" ? 1 : -1;
  const entry = x.last;
  const tp = Number(await roundToTick(x.instId, entry + dirSign * tpAtr * x.atr));
  const slPx = Number(await roundToTick(x.instId, entry - dirSign * slAtr * x.atr));
  const atrLabels = { ...Object.fromEntries(Object.entries(tpOpts).map(([k, v]) => [k, `${v} ATR`])), ...Object.fromEntries(Object.entries(slOpts).map(([k, v]) => [k, `${v} ATR`])) };
  yield { type: "decision", key: "tp", title: "Take profit", jev: rj.answers.tp, laya: rl.answers.tp, jevMs: rj.latencyMs, jevSrc: rj.modelId, jevProvider: rj.provider, layaMs: rl.latencyMs, pick: tpKey, labels: atrLabels };
  yield { type: "decision", key: "sl", title: "Stop loss", jev: rj.answers.sl, laya: rl.answers.sl, jevMs: rj.latencyMs, jevSrc: rj.modelId, jevProvider: rj.provider, layaMs: rl.latencyMs, pick: slKey, labels: atrLabels };
  yield { type: "stage", stage: "risk", status: "done" };

  /* 8. GATE: yes/no proposition, both models must agree ----------------- */
  yield { type: "stage", stage: "gate", status: "start" };
  const rr = tpAtr / slAtr;
  const gateQ: Record<string, Question> = {
    gate: {
      type: "noul",
      instructions: `Opening a ${side} on ${x.instId} now with TP ${tp}, SL ${slPx} (reward/risk ${rr.toFixed(2)}) has positive expected value.`,
      prior: Math.min(0.92, Math.max(0.08, 0.35 + dirP * 0.45 + (rr - 1) * 0.08 - Math.max(0, x.atrPct - 2) * 0.1)),
    },
  };
  const [gj, gl] = await Promise.all([decide("jev", state, gateQ), decide("laya", state, gateQ)]);
  const gate = 0.6 * (gj.answers.gate.value ?? 0.5) + 0.4 * (gl.answers.gate.value ?? 0.5);
  const pass = gate >= 0.55 && (gj.answers.gate.value ?? 0) >= 0.5 && (gl.answers.gate.value ?? 0) >= 0.45;
  yield { type: "decision", key: "gate", title: "Risk kapısı", jev: gj.answers.gate, laya: gl.answers.gate, jevMs: gj.latencyMs, jevSrc: gj.modelId, jevProvider: gj.provider, layaMs: gl.latencyMs, pick: pass ? "yes" : "no" };
  yield { type: "stage", stage: "gate", status: pass ? "done" : "fail", note: `p(EV>0)=${pct(gate)}` };

  const contracts = await roundLot(x.instId, notional / entry);
  const plan: Plan = { instId: x.instId, side, entry, tp, sl: slPx, tpAtr, slAtr, notional, contracts, leverage, rr, confidence: dirP, gate };
  yield { type: "plan", plan };

  const b = await brief;
  if (b) yield { type: "narration", text: b };

  if (!pass) {
    yield { type: "log", tone: "warn", text: `Kapı geçilemedi (p=${pct(gate)}). Emir gönderilmedi.` };
    yield { type: "stage", stage: "execute", status: "skip" };
    yield { type: "done", ms: Date.now() - t0, verdict: "hold" };
    return;
  }

  /* 9. EXECUTE via ATK ------------------------------------------------- */
  if (!execute) {
    yield { type: "stage", stage: "execute", status: "skip", note: "plan modu" };
    yield* explain(plan, pairP);
    yield { type: "done", ms: Date.now() - t0, verdict: "planned" };
    return;
  }
  yield { type: "stage", stage: "execute", status: "start" };
  const clOrdId = `${opts.tag ?? "aviax"}${Date.now()}`.replace(/[^a-zA-Z0-9]/g, "").slice(0, 32);
  try {
    // 1. Market buy for a USDT amount.
    yield { type: "log", tool: "spot_place_order", text: `ATK → ${base(x.instId)} spot market alım, ${notional} USDT` };
    const r = await atkCall("spot_place_order", { instId: x.instId, tdMode: "cash", side: "buy", ordType: "market", sz: String(notional), tgtCcy: "quote_ccy", clOrdId });
    const ord = okxResult(r);

    // 2. Read the fill: real entry and the base amount actually received (fee is taken in base).
    let fill = await getOrder(x.instId, ord.ordId).catch(() => null);
    for (let i = 0; i < 5 && fill && fill.state !== "filled"; i++) {
      await new Promise((res) => setTimeout(res, 400));
      fill = await getOrder(x.instId, ord.ordId).catch(() => fill);
    }
    const avgPx = Number(fill?.avgPx || entry);
    const feeBase = fill && fill.feeCcy === base(x.instId) ? Math.abs(Number(fill.fee)) : 0;
    const qty = await roundLot(x.instId, Number(fill?.accFillSz || contracts) - feeBase);
    plan.entry = avgPx;
    plan.contracts = qty;
    yield { type: "log", tone: "ok", text: `Alım doldu: ${qty} ${base(x.instId)} @ ${avgPx} (ordId ${ord.ordId})` };

    // 3. Protect it: OCO sell with TP and SL for exactly that quantity.
    yield { type: "log", tool: "spot_place_algo_order", text: `ATK → OCO satış: TP ${tp} / SL ${slPx}, ${qty} ${base(x.instId)}` };
    const a = await atkCall("spot_place_algo_order", {
      instId: x.instId,
      tdMode: "cash",
      side: "sell",
      ordType: "oco",
      sz: qty,
      tpTriggerPx: String(tp),
      tpOrdPx: "-1",
      slTriggerPx: String(slPx),
      slOrdPx: "-1",
      algoClOrdId: `${clOrdId}o`.slice(0, 32),
    });
    const algo = okxResult(a) as unknown as { algoId: string };
    yield { type: "order", ok: true, detail: `AL ${x.instId} · ${qty} ${base(x.instId)}`, ordId: ord.ordId, algoId: algo.algoId, qty, avgPx };
    yield { type: "log", tone: "ok", text: `OCO aktif: algoId ${algo.algoId}` };
    yield { type: "stage", stage: "execute", status: "done" };
    yield* explain(plan, pairP);
    yield { type: "done", ms: Date.now() - t0, verdict: "executed" };
  } catch (e) {
    yield { type: "order", ok: false, detail: (e as Error).message };
    yield { type: "log", tone: "err", text: `Emir hatası: ${(e as Error).message}` };
    yield { type: "stage", stage: "execute", status: "fail" };
    yield { type: "done", ms: Date.now() - t0, verdict: "error" };
  }
}

/** Unwraps an ATK order response or throws a readable error. */
function okxResult(r: unknown): { ordId: string; sCode?: string; sMsg?: string } {
  const err = r as { error?: boolean; code?: string; message?: string };
  if (err?.error)
    throw new Error(
      err.code === "50123" || err.code === "50124"
        ? `OKX ${err.code}: API anahtarının spot işlem izni yok. Demo API anahtarını Trade izniyle yeniden oluşturup .env.local'e yaz.`
        : `OKX ${err.code}: ${err.message}`,
    );
  const d = atkData<{ ordId: string; algoId?: string; sCode?: string; sMsg?: string }>(r)[0];
  if (!d || (d.sCode && d.sCode !== "0")) throw new Error(d?.sMsg || JSON.stringify(r).slice(0, 200));
  return d;
}

async function* explain(plan: Plan, pairP: number): AsyncGenerator<AgentEvent> {
  const text = await narrate(
    SYS,
    `Agent şu spot kararı verdi: ${plan.instId} alım, giriş ${plan.entry}, TP ${plan.tp} (${plan.tpAtr} ATR), SL ${plan.sl} (${plan.slAtr} ATR), ${plan.notional} USDT. Parite olasılığı ${pct(pairP)}, yön olasılığı ${pct(plan.confidence)}, risk kapısı p(EV>0) ${pct(plan.gate)}. Bu kararın gerekçesini açıkla.`,
  );
  if (text) yield { type: "narration", text };
}
