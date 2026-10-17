import { atkCall, atkData } from "./atk";
import { parseCandles } from "./features";
import { getBalance, hasOkxKeys } from "./okx";
import type { OkxCredentials } from "./companySession";
import { ask, recordHash, route, type LayerAnswer, type Seats } from "./decisionLayer";
import { decide, type Question } from "./decide";

/**
 * Risk desk: the worked example of the decision layer.
 * Code does what code is good at (exact limit checks, order sizing); decision models do the
 * judgement (risk level, response class, how much to de-risk). Anything large, uncertain or
 * contested goes to a human approval queue before OKX execution and Fuji anchoring.
 */

export type Policy = { maxWeight: number; maxDrawdown: number; minReserve: number; maxVol: number; approvalUsd: number };
export const DEFAULT_POLICY: Policy = { maxWeight: 40, maxDrawdown: 15, minReserve: 20, maxVol: 60, approvalUsd: 10_000 };

export type Shock = "none" | "market10" | "avax30" | "crash40";
export const SHOCKS: Record<Shock, { label: string; move: (ccy: string) => number }> = {
  none: { label: "Şok yok (canlı piyasa)", move: () => 0 },
  market10: { label: "Tüm kripto -%10", move: () => -0.1 },
  avax30: { label: "AVAX -%30", move: (c) => (c === "AVAX" ? -0.3 : 0) },
  crash40: { label: "Çöküş: BTC -%40, diğerleri -%50", move: (c) => (c === "BTC" ? -0.4 : -0.5) },
};

export type Source = "okx" | "fund" | "dao";
const PRESETS: Record<Exclude<Source, "okx">, { label: string; total: number; weights: Record<string, number> }> = {
  fund: { label: "Örnek kripto fonu", total: 1_000_000, weights: { USDT: 25, BTC: 40, ETH: 25, AVAX: 10 } },
  dao: { label: "Örnek DAO hazinesi", total: 2_500_000, weights: { USDC: 10, AVAX: 60, ETH: 20, BTC: 10 } },
};

const STABLE = new Set(["USDT", "USDC", "DAI", "FDUSD", "USDG"]);
const FIAT = new Set(["TRY", "USD", "EUR"]);
const isReserve = (c: string) => STABLE.has(c) || FIAT.has(c);

export type Holding = { ccy: string; qty: number; px: number; usd: number; weight: number; reserve: boolean; chg7d: number | null; shock: number };
export type Check = { key: string; label: string; value: number; limit: number; unit: string; status: "ok" | "near" | "breach"; dir: "max" | "min" };
export type Order = { instId: string; ccy: string; side: "sell"; qty: number; usd: number; reason: string };
export type ReviewerOpinion = { modelId: string; source: "live" | "shadow"; latencyMs: number; answers: Record<string, Record<string, number>>; cached?: boolean; error?: string };

export type RiskEvent =
  | { type: "stage"; stage: string; text: string }
  | { type: "route"; desk: string; answer: LayerAnswer; ms: number }
  | { type: "portfolio"; source: Source; label: string; total: number; holdings: Holding[] }
  | { type: "checks"; checks: Check[]; vol: number; drawdown: number; var95: number; series: number[] }
  | { type: "models"; state: string; answers: Record<string, LayerAnswer>; models: { seat: string; modelId: string; source: string; latencyMs: number; error?: string }[]; reviewers: ReviewerOpinion[] }
  | { type: "decision"; record: DecisionRecord }
  | { type: "error"; text: string }
  | { type: "done" };

export type DecisionRecord = {
  id: string;
  ts: number;
  desk: "risk";
  companyName: string;
  verdict: "yes" | "no" | "uncertain";
  verdictConfidence: number;
  verdictProbabilities: Record<"yes" | "no" | "uncertain", number>;
  source: Source;
  shock: Shock;
  policy: Policy;
  riskLevel: string;
  action: string;
  cut: string;
  confidence: number;
  agreement: number;
  modelRuleMatch: boolean;
  orders: Order[];
  sellUsd: number;
  approval: { required: boolean; reasons: string[] };
  models: string[];
  hash: `0x${string}`;
};

const CUT: Record<string, number> = { none: 0, small: 0.1, half: 0.5, all: 1 };
const reviewerState = globalThis as typeof globalThis & {
  __riskReviewerCache?: Map<string, { at: number; opinion: ReviewerOpinion }>;
  __riskReviewerTurn?: number;
};
reviewerState.__riskReviewerCache ??= new Map();
reviewerState.__riskReviewerTurn ??= 0;

export const RISK_QUESTIONS = (): Record<string, Question> => ({
  verdict: { type: "choice", instructions: "Should this company take a risk-management action now, based on its live portfolio, market data, and stated policy? Choose yes if the portfolio needs intervention, no if it should stay as-is, or uncertain if evidence is mixed and a human should decide.", criteria: { yes: "Yes: intervene now to bring the company portfolio in line with policy", no: "No: hold the current company portfolio", uncertain: "Uncertain: evidence is mixed; defer the decision to a human" } },
  risk_level: { type: "choice", instructions: "Classify the current risk level of this portfolio relative to its policy.", criteria: { low: "Comfortably inside all policy limits", elevated: "Near limits or one limit breached, needs attention", critical: "Multiple limits breached, immediate action required" } },
  action: { type: "choice", instructions: "Which risk action should the risk committee take now?", criteria: { hold: "Keep the portfolio unchanged", rebalance: "Trim the largest position back inside limits", derisk: "Move a significant share into stablecoins", exit: "Liquidate risky assets to stablecoins immediately" } },
  breach: { type: "noul", instructions: "At least one hard policy limit is currently breached." },
  dd_breach: { type: "noul", instructions: "The portfolio's drawdown has already exceeded its policy limit." },
  cut: { type: "choice", instructions: "How much of the risky assets should move to stablecoins to bring the portfolio back inside policy?", criteria: { none: "0%, nothing is breached", small: "about 10%, a minor breach or near limits", half: "about 50%, several limits breached", all: "100%, drawdown breached and the market is crashing" } },
});

const dailyCloseCache = new Map<string, { at: number; values: number[] }>();
async function dailyCloses(ccy: string): Promise<number[]> {
  const cached = dailyCloseCache.get(ccy);
  if (cached && Date.now() - cached.at < 5 * 60_000) return cached.values;
  const r = await atkCall("market_get_candles", { instId: `${ccy}-USDT`, bar: "1D", limit: 60 });
  const values = parseCandles(atkData<string[]>(r)).map((c) => c.c);
  dailyCloseCache.set(ccy, { at: Date.now(), values });
  return values;
}

async function loadPortfolio(source: Source, companyName: string, credentials?: OkxCredentials) {
  if (source === "okx") {
    if (!credentials && !hasOkxKeys()) throw new Error("OKX demo hesabını bağla");
    const bal = await getBalance(credentials);
    const rows = (bal.details as { ccy: string; eq: string; eqUsd?: string }[]).map((d) => ({ ccy: d.ccy, qty: Number(d.eq), usd: Number(d.eqUsd ?? 0) })).filter((d) => d.usd >= 1);
    if (!rows.length) throw new Error("OKX hesabında şirket portföyüne alınacak en az 1 USD değerinde varlık bulunamadı");
    return { label: `${companyName} · OKX demo hesabı (canlı)`, rows };
  }
  const p = PRESETS[source];
  return { label: `${companyName} · ${p.label} (örnek veri)`, rows: Object.entries(p.weights).map(([ccy, w]) => ({ ccy, qty: NaN, usd: (p.total * w) / 100 })) };
}

const status = (v: number, limit: number, dir: "max" | "min"): Check["status"] => {
  if (dir === "max") return v > limit ? "breach" : v > limit * 0.85 ? "near" : "ok";
  return v < limit ? "breach" : v < limit * 1.15 ? "near" : "ok";
};

export async function* runRiskDesk(opts: { source: Source; shock: Shock; policy: Policy; companyName?: string; request?: string; seats?: Seats; reviewers?: string[]; okxCredentials?: OkxCredentials; openrouterKey?: string }): AsyncGenerator<RiskEvent> {
  const { policy, shock } = opts;
  const companyName = opts.companyName?.trim().slice(0, 64) || "Şirket hazinesi";

  // 1. Routing: a decision model, not a keyword rule, picks the desk.
  if (opts.request) {
    yield { type: "stage", stage: "route", text: "Talep masaya yönlendiriliyor" };
    const t = Date.now();
    const r = await route(opts.request, opts.seats);
    yield { type: "route", desk: r.desk, answer: r.answer, ms: Date.now() - t };
    if (r.desk !== "risk") {
      yield { type: "stage", stage: "route", text: `Talep "${r.desk}" masasına ait. Bu demoda sadece risk masası canlı.` };
      yield { type: "done" };
      return;
    }
  }

  // 2. Portfolio + market history via OKX Agent Trade Kit.
  yield { type: "stage", stage: "portfolio", text: opts.source === "okx" ? "OKX demo bakiyesi okunuyor" : "Örnek portföy yükleniyor" };
  const pf = await loadPortfolio(opts.source, companyName, opts.okxCredentials);
  yield { type: "stage", stage: "market", text: "ATK market_get_candles · 60 günlük kapanışlar" };
  const risky = pf.rows.filter((r) => !isReserve(r.ccy));
  const closes = Object.fromEntries(await Promise.all(risky.map(async (r) => [r.ccy, await dailyCloses(r.ccy).catch(() => [] as number[])] as const)));

  // Shock is applied as an instantaneous move on top of live prices (stress test).
  const move = SHOCKS[shock].move;
  const rows = pf.rows.map((r) => {
    const reserve = isReserve(r.ccy);
    const s = reserve ? 0 : move(r.ccy);
    const cs = closes[r.ccy] ?? [];
    const px = cs.length ? cs[cs.length - 1] : r.qty ? r.usd / r.qty : 1;
    return { ...r, reserve, shock: s, usd: r.usd * (1 + s), px: px * (1 + s), qty: Number.isNaN(r.qty) ? (r.usd / (cs.at(-1) || 1)) : r.qty, chg7d: cs.length > 7 ? (cs.at(-1)! / cs.at(-8)! - 1) * 100 : null };
  });
  const total = rows.reduce((t, r) => t + r.usd, 0);
  const holdings: Holding[] = rows.map((r) => ({ ...r, weight: (r.usd / total) * 100 })).sort((a, b) => b.usd - a.usd);
  yield { type: "portfolio", source: opts.source, label: pf.label, total, holdings };

  // 3. Hard checks (deterministic): concentration, reserve, volatility, 30d drawdown, 1d VaR.
  const len = Math.min(...holdings.filter((h) => !h.reserve).map((h) => closes[h.ccy]?.length || 0).filter(Boolean), 60);
  const rets: number[] = [];
  for (let i = 1; i < len; i++) {
    let r = 0;
    for (const h of holdings) {
      if (h.reserve) continue;
      const c = closes[h.ccy];
      if (!c?.length) continue;
      const a = c[c.length - len + i - 1];
      const b = c[c.length - len + i];
      r += (h.weight / 100) * (b / a - 1);
    }
    rets.push(r);
  }
  const preTotal = holdings.reduce((t, h) => t + h.usd / (1 + h.shock), 0);
  const shockRet = holdings.reduce((t, h) => t + (h.usd / (1 + h.shock) / preTotal) * h.shock, 0);
  if (shock !== "none") rets.push(shockRet);
  const mean = rets.reduce((a, b) => a + b, 0) / (rets.length || 1);
  const vol = Math.sqrt(rets.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, rets.length - 1)) * Math.sqrt(365) * 100;
  const series = [1];
  for (const r of rets) series.push(series[series.length - 1] * (1 + r));
  const win = series.slice(-31);
  const peak = Math.max(...win);
  const drawdown = (1 - win[win.length - 1] / peak) * 100;
  const sorted = [...rets].sort((a, b) => a - b);
  const var95 = -(sorted[Math.floor(sorted.length * 0.05)] ?? 0) * 100;
  const top = holdings.filter((h) => !h.reserve)[0];
  const reserve = holdings.filter((h) => h.reserve).reduce((t, h) => t + h.weight, 0);

  const checks: Check[] = [
    { key: "weight", label: `En büyük pozisyon (${top?.ccy ?? "-"})`, value: top?.weight ?? 0, limit: policy.maxWeight, unit: "%", status: status(top?.weight ?? 0, policy.maxWeight, "max"), dir: "max" },
    { key: "reserve", label: "Stablecoin + nakit rezervi", value: reserve, limit: policy.minReserve, unit: "%", status: status(reserve, policy.minReserve, "min"), dir: "min" },
    { key: "drawdown", label: "30 günlük düşüş (drawdown)", value: drawdown, limit: policy.maxDrawdown, unit: "%", status: status(drawdown, policy.maxDrawdown, "max"), dir: "max" },
    { key: "vol", label: "Yıllık volatilite", value: vol, limit: policy.maxVol, unit: "%", status: status(vol, policy.maxVol, "max"), dir: "max" },
  ];
  yield { type: "checks", checks, vol, drawdown, var95, series: win };

  // 4. Decision models judge the situation (two seats, one forward pass each).
  yield { type: "stage", stage: "models", text: "Karar modelleri soruluyor" };
  const breaches = checks.filter((c) => c.status === "breach");
  const near = checks.filter((c) => c.status === "near");
  const f = (n: number) => n.toFixed(1);
  const state = [
    `Institution: ${companyName}. Portfolio source: ${pf.label}. Policy: max single-asset weight ${policy.maxWeight}%, max 30-day drawdown ${policy.maxDrawdown}%, min stablecoin reserve ${policy.minReserve}%, max annualized volatility ${policy.maxVol}%, human approval threshold USD ${policy.approvalUsd}.`,
    `Portfolio (USD ${Math.round(total).toLocaleString("en-US")}): ${holdings.map((h) => `${h.ccy} ${f(h.weight)}%`).join(", ")}.`,
    shock !== "none" ? `Stress scenario applied: ${SHOCKS[shock].label}.` : "",
    `Measured: ${checks.map((c) => `${c.label.replace(/\s*\(.*\)/, "")} ${f(c.value)}% (${c.dir === "max" ? "limit" : "min"} ${c.limit}%${c.status === "breach" ? ", BREACH" : c.status === "near" ? ", near" : ""})`).join(". ")}. 1-day VaR95 ${f(var95)}%.`,
    holdings.filter((h) => !h.reserve && h.chg7d !== null).map((h) => `${h.ccy} 7d ${h.chg7d! >= 0 ? "+" : ""}${f(h.chg7d!)}%`).join(", ") + ".",
    `Hard policy checks: ${breaches.length ? `${breaches.length} breach (${breaches.map((b) => b.key).join(", ")})` : "all within limits"}${near.length ? `, ${near.length} near limit` : ""}.`,
  ].filter(Boolean).join("\n");
  const questions = RISK_QUESTIONS();
  const reviewerSpecs = [...new Set(opts.reviewers ?? [])];
  const nextReviewer = reviewerSpecs.length ? reviewerSpecs[(reviewerState.__riskReviewerTurn!++) % reviewerSpecs.length] : undefined;
  const [res, latestReviewer] = await Promise.all([
    ask(state, questions, opts.seats, { strict: true, openrouterKey: opts.openrouterKey }),
    nextReviewer ? decide("jev", state, questions, nextReviewer, opts.openrouterKey, { timeoutMs: 7_000, attempts: 1 }) : Promise.resolve(null),
  ]);
  const now = Date.now();
  let failedReviewer: ReviewerOpinion | undefined;
  if (nextReviewer && latestReviewer) {
    const opinion: ReviewerOpinion = {
      modelId: latestReviewer.source === "live" ? latestReviewer.modelId : nextReviewer.replace(/^openrouter:/, ""),
      source: latestReviewer.source,
      latencyMs: latestReviewer.latencyMs,
      answers: Object.fromEntries(["verdict", "action", "cut"].map((key) => [key, latestReviewer.answers[key]?.probabilities ?? {}])),
      error: latestReviewer.source === "live" ? undefined : latestReviewer.error?.slice(0, 200) ?? "Model canlı cevap vermedi",
    };
    if (opinion.source === "live") reviewerState.__riskReviewerCache!.set(nextReviewer, { at: now, opinion });
    else failedReviewer = opinion;
  }
  const reviewerResults: ReviewerOpinion[] = reviewerSpecs.map((spec) => {
    const cached = reviewerState.__riskReviewerCache!.get(spec);
    if (cached && now - cached.at < 25_000) return { ...cached.opinion, cached: spec !== nextReviewer || !latestReviewer || latestReviewer.source !== "live" };
    if (spec === nextReviewer && failedReviewer) return failedReviewer;
    return { modelId: spec.replace(/^openrouter:/, ""), source: "shadow", latencyMs: 0, answers: {}, error: "Sıradaki OpenRouter turunda değerlendirilecek" };
  });
  const liveReviewers = reviewerResults.filter((r) => r.source === "live");
  const localVerdict = res.answers.verdict.ensemble;
  const localWeight = liveReviewers.length ? 0.5 : 1;
  const advisorWeight = liveReviewers.length ? 0.5 / liveReviewers.length : 0;
  const verdictProbabilities = Object.fromEntries(["yes", "no", "uncertain"].map((label) => [
    label,
    localWeight * (localVerdict[label] ?? 0) + liveReviewers.reduce((sum, reviewer) => sum + advisorWeight * (reviewer.answers.verdict?.[label] ?? 0), 0),
  ])) as Record<"yes" | "no" | "uncertain", number>;
  const rankedVerdicts = Object.entries(verdictProbabilities).sort((a, b) => b[1] - a[1]);
  const [topVerdict, topProbability] = rankedVerdicts[0] as ["yes" | "no" | "uncertain", number];
  const verdict: "yes" | "no" | "uncertain" = topVerdict === "uncertain" || topProbability < 0.5 || topProbability - (rankedVerdicts[1]?.[1] ?? 0) < 0.1 ? "uncertain" : topVerdict;
  const verdictConfidence = verdict === "uncertain" ? Math.max(topProbability, verdictProbabilities.uncertain) : verdictProbabilities[verdict];
  yield { type: "models", state, answers: res.answers, models: res.models, reviewers: reviewerResults };

  // 5. Orders: hard rules restore limits; the model's cut decides how far beyond that to de-risk.
  const a = res.answers;
  const cutPct = a.action.pick === "hold" ? 0 : CUT[a.cut.pick] ?? 0;
  const sell: Record<string, { usd: number; reasons: string[] }> = {};
  const add = (ccy: string, usd: number, why: string) => {
    if (usd <= 0) return;
    sell[ccy] ??= { usd: 0, reasons: [] };
    if (usd > sell[ccy].usd) sell[ccy].usd = usd;
    sell[ccy].reasons.push(why);
  };
  for (const h of holdings) if (!h.reserve && h.weight > policy.maxWeight) add(h.ccy, ((h.weight - policy.maxWeight + 2) / 100) * total, `yoğunlaşma > %${policy.maxWeight}`);
  if (reserve < policy.minReserve) {
    const need = ((policy.minReserve - reserve + 2) / 100) * total;
    const riskyUsd = holdings.filter((h) => !h.reserve).reduce((t, h) => t + h.usd, 0);
    for (const h of holdings) if (!h.reserve) add(h.ccy, (h.usd / riskyUsd) * need, `rezerv < %${policy.minReserve}`);
  }
  if (cutPct > 0) for (const h of holdings) if (!h.reserve) add(h.ccy, h.usd * cutPct, `model: riskli varlıkların %${cutPct * 100}'i`);
  const orders: Order[] = Object.entries(sell)
    .map(([ccy, s]) => {
      const h = holdings.find((x) => x.ccy === ccy)!;
      const usd = Math.min(s.usd, h.usd);
      return { instId: `${ccy}-USDT`, ccy, side: "sell" as const, qty: usd / h.px, usd, reason: [...new Set(s.reasons)].join(" · ") };
    })
    .filter((o) => o.usd >= 1);
  const sellUsd = orders.reduce((t, o) => t + o.usd, 0);

  // 6. Governance: when does a human have to sign off?
  const modelRuleMatch = a.breach.pick === "yes" === breaches.length > 0;
  const confidence = Math.min(a.risk_level.confidence, a.action.confidence);
  const agreement = Math.min(a.risk_level.agreement, a.action.agreement);
  const reasons: string[] = [];
  if (["derisk", "exit"].includes(a.action.pick)) reasons.push(`aksiyon "${a.action.pick}" geniş kapsamlı`);
  if (sellUsd > policy.approvalUsd) reasons.push(`satış ${Math.round(sellUsd).toLocaleString("tr-TR")} USD > onay eşiği ${policy.approvalUsd.toLocaleString("tr-TR")} USD`);
  if (confidence < 0.55) reasons.push(`düşük güven (%${Math.round(confidence * 100)})`);
  if (agreement < 0.5) reasons.push("modeller anlaşamadı");
  if (verdict === "uncertain") reasons.push("evet/hayır kararı belirsiz, insan değerlendirmesi gerekli");
  if (liveReviewers.some((r) => (r.answers.verdict?.yes ?? 0) > 0.5) && liveReviewers.some((r) => (r.answers.verdict?.no ?? 0) > 0.5)) reasons.push("OpenRouter danışman modelleri farklı öneriler verdi");
  if (!modelRuleMatch) reasons.push("model ile kural kontrolü çelişiyor");
  const required = orders.length > 0 && reasons.length > 0;

  const body = {
    desk: "risk" as const,
    companyName,
    verdict,
    verdictConfidence,
    verdictProbabilities,
    source: opts.source,
    shock,
    policy,
    riskLevel: a.risk_level.pick,
    action: a.action.pick,
    cut: a.cut.pick,
    confidence,
    agreement,
    modelRuleMatch,
    orders,
    sellUsd,
    approval: { required, reasons },
    models: [...res.models.map((m) => m.modelId), ...liveReviewers.map((m) => m.modelId)],
    state,
  };
  const ts = Date.now();
  const hash = recordHash({ ...body, ts });
  const { state: _s, ...rest } = body;
  yield { type: "decision", record: { id: hash.slice(2, 12), ts, ...rest, hash } };
  yield { type: "done" };
}
