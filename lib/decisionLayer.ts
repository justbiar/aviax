import { keccak256, toHex } from "viem";
import { decide, type Answer, type DecisionResult, type Question } from "./decide";

/**
 * Decision layer: the reusable core behind /api/decision and the MCP endpoint.
 * Any agent sends { state, questions }; two decision models answer in one forward
 * pass each and the layer returns per-model and ensemble distributions, agreement
 * and a deterministic hash of the record so it can be anchored on-chain.
 */

export type Seats = { primary?: string; second?: string };
export const DEFAULT_SEATS = { primary: "ollama:strands-decider", second: "ollama:laya" };
export const WEIGHTS = { primary: 0.6, second: 0.4 };

export type LayerAnswer = {
  type: Question["type"];
  labels: string[];
  primary: Record<string, number>;
  second: Record<string, number> | null;
  ensemble: Record<string, number>;
  pick: string;
  confidence: number;
  /** 1 when both seats pick the same option and their distributions overlap fully. */
  agreement: number;
};

export type LayerResult = {
  answers: Record<string, LayerAnswer>;
  models: { seat: "primary" | "second"; modelId: string; source: "live" | "shadow"; latencyMs: number; error?: string }[];
  live: boolean;
};

const dist = (a: Answer | undefined, q: Question): Record<string, number> => {
  if (!a) return {};
  if (q.type === "noul") return { yes: a.value ?? 0.5, no: 1 - (a.value ?? 0.5) };
  const labels = q.type === "choice" ? Object.keys(q.criteria) : q.criteria;
  // Ollama returns score levels keyed by index; map them back to their labels.
  return Object.fromEntries(labels.map((l, i) => [l, a.probabilities[l] ?? a.probabilities[String(i)] ?? 0]));
};

export async function ask(state: string, questions: Record<string, Question>, seats: Seats = {}, opts: { strict?: boolean; openrouterKey?: string } = {}): Promise<LayerResult> {
  const p = seats.primary ?? DEFAULT_SEATS.primary;
  const s = seats.second === "" ? null : seats.second ?? DEFAULT_SEATS.second;
  let [a, b] = await Promise.all([decide("jev", state, questions, p, opts.openrouterKey), s ? decide("laya", state, questions, s, opts.openrouterKey) : Promise.resolve(null as DecisionResult | null)]);

  // Keep the local model as the normal demo path. If it is unavailable, an
  // explicitly enabled server-side OpenRouter fallback keeps the public demo live.
  const fallbackEnabled = process.env.DECISION_OPENROUTER_FALLBACK === "1" && Boolean(process.env.OPENROUTER_API_KEY);
  const primaryIsLocal = p.startsWith("ollama:") || (p === DEFAULT_SEATS.primary && process.env.JEV_PROVIDER === "endpoint");
  if (fallbackEnabled && primaryIsLocal && a.source !== "live") {
    const modelId = process.env.JEV_OPENROUTER_MODEL || process.env.OPENROUTER_MODEL || "openrouter/free";
    a = await decide("jev", state, questions, `openrouter:${modelId}`, opts.openrouterKey ?? process.env.OPENROUTER_API_KEY);
  }

  const okB = b && (!opts.strict || b.source === "live") ? b : null;
  if (opts.strict && a.source !== "live") throw new Error(`primary model unavailable: ${a.error ?? "no answer"}`);

  const answers: Record<string, LayerAnswer> = {};
  for (const [key, q] of Object.entries(questions)) {
    const pa = dist(a.answers[key], q);
    const pb = okB ? dist(okB.answers[key], q) : null;
    const labels = Object.keys(pa);
    const w = pb ? WEIGHTS : { primary: 1, second: 0 };
    const ens = Object.fromEntries(labels.map((l) => [l, w.primary * pa[l] + w.second * (pb?.[l] ?? 0)]));
    const pick = labels.reduce((x, l) => (ens[l] > ens[x] ? l : x), labels[0]);
    const argmax = (d: Record<string, number>) => labels.reduce((x, l) => (d[l] > d[x] ? l : x), labels[0]);
    const overlap = pb ? labels.reduce((t, l) => t + Math.min(pa[l], pb[l]), 0) : 1;
    const agreement = pb ? (argmax(pa) === argmax(pb) ? 0.5 + overlap / 2 : overlap / 2) : 1;
    answers[key] = { type: q.type, labels, primary: pa, second: pb, ensemble: ens, pick, confidence: ens[pick], agreement };
  }
  const models = [a, okB].filter(Boolean).map((r, i) => ({ seat: (i === 0 ? "primary" : "second") as "primary" | "second", modelId: r!.modelId, source: r!.source, latencyMs: r!.latencyMs, error: r!.error }));
  return { answers, models, live: models.every((m) => m.source === "live") };
}

/** Stable hash of a decision record (sorted keys) for on-chain anchoring. */
export function recordHash(record: unknown) {
  const sort = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(sort) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v as object).sort().map((k) => [k, sort((v as Record<string, unknown>)[k])])) : v;
  return keccak256(toHex(JSON.stringify(sort(record))));
}

/** Routing: the first decision picks which desk handles a free-form institutional request. */
export const DESKS = {
  risk: { label: "Risk yönetimi", criteria: "Risk management: market exposure, drawdown, volatility, stress", live: true },
  portfolio: { label: "Portföy stratejisi", criteria: "Portfolio strategy: target weights and allocation for return", live: false },
  treasury: { label: "Hazine ve likidite", criteria: "Treasury and liquidity: cash needs, runway, payments, reserves", live: false },
  governance: { label: "Yönetişim ve yetki", criteria: "Governance: whether an action is authorized, approval limits, mandates of people or agents", live: false },
} as const;
export type Desk = keyof typeof DESKS;

export const routeQuestion = (): Record<string, Question> => ({
  desk: {
    type: "choice",
    instructions: "Route this institutional request to the right decision desk.",
    criteria: Object.fromEntries(Object.entries(DESKS).map(([k, d]) => [k, d.criteria])),
  },
});

export async function route(request: string, seats?: Seats) {
  const r = await ask(`Request from an institution's operator: "${request}"`, routeQuestion(), seats);
  return { desk: r.answers.desk.pick as Desk, answer: r.answers.desk, models: r.models, live: r.live };
}
