/**
 * Decision-model layer for JEV (TypeSafe, hosted) and LAYA (open-source).
 * Both are non-autoregressive: one forward pass returns a probability distribution,
 * never generated text. Same request contract for both: { model, state, questions }.
 *
 * If a model has no credentials, a local shadow estimator answers from the
 * feature-derived priors so the demo keeps running. Answers carry `source`
 * so the UI can show "live" vs "shadow".
 */

export type ChoiceQ = { type: "choice"; instructions: string; criteria: Record<string, string>; prior?: Record<string, number> };
export type ScoreQ = { type: "score"; instructions: string; criteria: string[]; prior?: number[] };
export type NoulQ = { type: "noul"; instructions: string; prior?: number };
export type Question = ChoiceQ | ScoreQ | NoulQ;

export type Answer = {
  type: Question["type"];
  /** choice: key -> p, score: level label -> p, noul: { yes, no } */
  probabilities: Record<string, number>;
  choice?: string;
  score?: number; // probability-weighted level index (0..n-1)
  value?: number; // noul probability of "yes"
  confidence: number;
};

export type ModelName = "jev" | "laya";
export type Provider = "typesafe" | "openrouter" | "endpoint" | "shadow";
export type DecisionResult = { model: ModelName; source: "live" | "shadow"; provider: Provider; latencyMs: number; modelId: string; answers: Record<string, Answer>; error?: string };

const cfg = {
  jev: () => ({
    url: process.env.JEV_BASE_URL || "https://api.typesafe.ai/v1/systemone",
    key: process.env.JEV_API_KEY,
    modelId: process.env.JEV_MODEL || "jev-latest",
  }),
  laya: () => ({
    url: process.env.LAYA_ENDPOINT,
    key: process.env.LAYA_API_KEY,
    modelId: process.env.LAYA_MODEL || "laya",
  }),
};

/**
 * JEV_PROVIDER picks the backend: "typesafe" (direct decision API), "openrouter"
 * (any OpenRouter model asked for a JSON distribution) or "shadow".
 * Default: typesafe when JEV_API_KEY is set, else openrouter when an OpenRouter key exists.
 */
export function provider(m: ModelName): Provider {
  if (m === "laya") {
    const p = process.env.LAYA_PROVIDER;
    if (p === "openrouter" && process.env.OPENROUTER_API_KEY) return "openrouter";
    return process.env.LAYA_ENDPOINT ? "endpoint" : "shadow";
  }
  const p = process.env.JEV_PROVIDER;
  if (p === "shadow") return "shadow";
  // Local System One server (Ollama /v1/systemone), no key needed.
  if (p === "endpoint") return process.env.JEV_BASE_URL ? "endpoint" : "shadow";
  if (p === "openrouter") return process.env.OPENROUTER_API_KEY ? "openrouter" : "shadow";
  if (p === "typesafe" || process.env.JEV_API_KEY) return process.env.JEV_API_KEY ? "typesafe" : "shadow";
  return process.env.OPENROUTER_API_KEY ? "openrouter" : "shadow";
}

export const isLive = (m: ModelName) => provider(m) !== "shadow";

/** Model id used when the provider is OpenRouter. */
export const openrouterModel = (m: ModelName) =>
  (m === "jev" ? process.env.JEV_OPENROUTER_MODEL : process.env.LAYA_OPENROUTER_MODEL) || "openrouter/free";

/**
 * Per-agent model override, e.g. "openrouter:liquid/lfm-2.5-2.6b:free",
 * "ollama:strands-decider" or "shadow". Only applies to JEV; LAYA stays env-configured.
 */
export type ModelSpec = string;

export const OLLAMA_URL = () => process.env.OLLAMA_SYSTEMONE_URL || "http://localhost:11434/v1/systemone";

export function resolveSpec(m: ModelName, spec?: ModelSpec): { prov: Provider; modelId: string; url?: string; key?: string } {
  if (m === "jev" && spec) {
    if (spec === "shadow") return { prov: "shadow", modelId: "shadow" };
    if (spec.startsWith("openrouter:")) return { prov: process.env.OPENROUTER_API_KEY ? "openrouter" : "shadow", modelId: spec.slice("openrouter:".length) };
    if (spec.startsWith("ollama:")) return { prov: "endpoint", modelId: spec.slice("ollama:".length), url: OLLAMA_URL() };
  }
  const prov = provider(m);
  const c = cfg[m]();
  return { prov, modelId: prov === "openrouter" ? openrouterModel(m) : c.modelId, url: c.url, key: c.key };
}

export async function decide(model: ModelName, state: string, questions: Record<string, Question>, spec?: ModelSpec): Promise<DecisionResult> {
  const r = resolveSpec(model, spec);
  const c = { ...cfg[model](), url: r.url, key: r.key, modelId: r.modelId };
  const t0 = performance.now();
  const prov = r.prov;
  if (prov === "openrouter") {
    try {
      const { answers, routed } = await openrouterDecide(r.modelId, state, questions);
      return { model, source: "live", provider: prov, latencyMs: Math.round(performance.now() - t0), modelId: routed, answers };
    } catch (e) {
      const shadow = shadowDecide(model, questions);
      return { ...shadow, latencyMs: Math.round(performance.now() - t0), error: (e as Error).message };
    }
  }
  if (prov === "typesafe" || prov === "endpoint") {
    try {
      const wire = Object.fromEntries(
        Object.entries(questions).map(([k, q]) => {
          const { prior: _prior, ...rest } = q as Question & { prior?: unknown };
          return [k, rest];
        }),
      );
      const res = await fetch(c.url!, {
        method: "POST",
        signal: AbortSignal.timeout(Number(process.env.DECISION_TIMEOUT_MS || 40000)),
        headers: { "Content-Type": "application/json", ...(c.key ? { Authorization: `Bearer ${c.key}` } : {}) },
        // keep_alive keeps local Ollama models resident between agent cycles.
        body: JSON.stringify({ model: c.modelId, state, questions: wire, ...(prov === "endpoint" ? { keep_alive: "30m" } : {}) }),
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.message || `HTTP ${res.status}`);
      return { model, source: "live", provider: prov, latencyMs: Math.round(performance.now() - t0), modelId: json.model || c.modelId, answers: normalize(questions, json) };
    } catch (e) {
      const shadow = shadowDecide(model, questions);
      return { ...shadow, latencyMs: Math.round(performance.now() - t0), error: (e as Error).message };
    }
  }
  const shadow = shadowDecide(model, questions);
  // Shadow mode mimics the real latency profile of a single forward pass.
  await new Promise((r) => setTimeout(r, model === "jev" ? 35 + Math.random() * 40 : 18 + Math.random() * 22));
  return { ...shadow, latencyMs: Math.round(performance.now() - t0) };
}

/* ---------- OpenRouter: ask any chat model for a calibrated JSON distribution ---------- */

const OR_SYSTEM =
  "You are a calibrated probabilistic decision model, not a chatbot. For every question you receive, return a probability distribution over exactly the allowed options. " +
  "Probabilities are numbers between 0 and 1 and sum to 1 per question. Be calibrated: do not put 1.0 on anything unless it is certain. Output JSON only, no prose, no markdown.";

async function openrouterDecide(orModel: string, state: string, questions: Record<string, Question>) {
  const spec = Object.fromEntries(
    Object.entries(questions).map(([k, q]) => [
      k,
      q.type === "noul"
        ? { type: "yes_no", statement: q.instructions, answer_format: { value: "probability the statement is true" } }
        : { type: q.type, question: q.instructions, options: q.type === "choice" ? q.criteria : q.criteria, answer_format: { probabilities: "option -> probability" } },
    ]),
  );
  const shape = '{"answers": {"<question_key>": {"probabilities": {"<option>": p, ...}}, "<yes_no_key>": {"value": p}}}';
  const user = `STATE:\n${state}\n\nQUESTIONS:\n${JSON.stringify(spec)}\n\nReturn exactly: ${shape}. Use the option keys verbatim (for "score" questions the options are the listed labels).`;

  let lastErr = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const res = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal: AbortSignal.timeout(Number(process.env.DECISION_TIMEOUT_MS || 40000)),
      headers: {
        Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:3000",
        "X-Title": "Aviax",
      },
      body: JSON.stringify({
        model: orModel,
        temperature: 0.2,
        max_tokens: 8000,
        reasoning: { effort: "low", exclude: true },
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: OR_SYSTEM },
          { role: "user", content: user },
        ],
      }),
      cache: "no-store",
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      lastErr = json?.error?.message || `HTTP ${res.status}`;
      if (res.status === 429 || res.status >= 500) {
        await new Promise((r) => setTimeout(r, 1500));
        continue;
      }
      break;
    }
    const text: string = json?.choices?.[0]?.message?.content ?? "";
    const parsed = extractJson(text);
    if (!parsed) {
      lastErr = `unparseable output: ${text.slice(0, 120)}`;
      continue;
    }
    return { answers: normalize(questions, parsed), routed: `openrouter:${json.model || orModel}` };
  }
  throw new Error(lastErr || "OpenRouter decision failed");
}

function extractJson(text: string): Record<string, unknown> | null {
  const cleaned = text.replace(/```(?:json)?/g, "");
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

/* ---------- response normalisation (tolerant to API shape variations) ---------- */

function normalize(questions: Record<string, Question>, json: Record<string, unknown>): Record<string, Answer> {
  const bag = (json.answers || json.results || json.questions || json.decisions || json) as Record<string, Record<string, unknown>>;
  const out: Record<string, Answer> = {};
  for (const [key, q] of Object.entries(questions)) {
    const a = (bag?.[key] ?? {}) as Record<string, unknown>;
    if (q.type === "noul") {
      const v = num(a.noul ?? a.value ?? a.probability ?? a.answer ?? a.score ?? a.p, 0.5);
      out[key] = { type: "noul", probabilities: { yes: v, no: 1 - v }, value: v, confidence: Math.abs(v - 0.5) * 2 };
      continue;
    }
    const labels = q.type === "choice" ? Object.keys(q.criteria) : q.criteria;
    // Some LLM backends return the distribution directly instead of under `probabilities`.
    const rawP = a.probabilities ?? a.distribution ?? a.probs ?? a;
    let probs: number[] = labels.map(() => 1 / labels.length);
    if (Array.isArray(rawP)) probs = labels.map((_, i) => num(rawP[i], 0));
    else if (rawP && typeof rawP === "object") probs = labels.map((l, i) => num(lookup(rawP as Record<string, unknown>, l) ?? (rawP as Record<string, unknown>)[String(i)], 0));
    probs = norm(probs);
    const best = argmax(probs);
    out[key] =
      q.type === "choice"
        ? { type: "choice", probabilities: zip(labels, probs), choice: (a.choice as string) || (a.answer as string) || labels[best], confidence: num(a.confidence, probs[best]) }
        : { type: "score", probabilities: zip(labels, probs), score: num(a.score, probs.reduce((s, p, i) => s + p * i, 0)), confidence: num(a.confidence, probs[best]) };
  }
  return out;
}

/** Exact key, then case/spacing-insensitive, then shared 4-char prefix (tolerates LLM typos). */
function lookup(obj: Record<string, unknown>, label: string) {
  if (label in obj) return obj[label];
  const norm = (k: string) => k.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const target = norm(label);
  const keys = Object.keys(obj);
  const hit = keys.find((k) => norm(k) === target) ?? keys.find((k) => norm(k).slice(0, 4) === target.slice(0, 4));
  return hit ? obj[hit] : undefined;
}

/* ---------- shadow estimator ---------- */

function shadowDecide(model: ModelName, questions: Record<string, Question>): Omit<DecisionResult, "latencyMs"> {
  // LAYA is a smaller encoder: slightly flatter, noisier distributions than JEV.
  const temp = model === "jev" ? 0.75 : 1.05;
  const noise = model === "jev" ? 0.18 : 0.32;
  const answers: Record<string, Answer> = {};
  for (const [key, q] of Object.entries(questions)) {
    if (q.type === "noul") {
      const p = clamp((q.prior ?? 0.5) + (Math.random() - 0.5) * noise * 0.5, 0.02, 0.98);
      answers[key] = { type: "noul", probabilities: { yes: p, no: 1 - p }, value: p, confidence: Math.abs(p - 0.5) * 2 };
      continue;
    }
    const labels = q.type === "choice" ? Object.keys(q.criteria) : q.criteria;
    const prior = q.type === "choice" ? labels.map((l) => q.prior?.[l] ?? 0) : labels.map((_, i) => q.prior?.[i] ?? 0);
    const probs = softmax(prior.map((x) => (x + gauss() * noise) / temp));
    const best = argmax(probs);
    answers[key] =
      q.type === "choice"
        ? { type: "choice", probabilities: zip(labels, probs), choice: labels[best], confidence: probs[best] }
        : { type: "score", probabilities: zip(labels, probs), score: probs.reduce((s, p, i) => s + p * i, 0), confidence: probs[best] };
  }
  return { model, source: "shadow", provider: "shadow", modelId: `${cfg[model]().modelId} (shadow)`, answers };
}

/* ---------- math ---------- */

const num = (v: unknown, d: number) => (typeof v === "number" && Number.isFinite(v) ? v : typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v)) ? Number(v) : d);
const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const norm = (p: number[]) => {
  const s = p.reduce((a, b) => a + b, 0);
  return s > 0 ? p.map((x) => x / s) : p.map(() => 1 / p.length);
};
const softmax = (x: number[]) => {
  const m = Math.max(...x);
  return norm(x.map((v) => Math.exp(v - m)));
};
const argmax = (p: number[]) => p.reduce((bi, v, i, arr) => (v > arr[bi] ? i : bi), 0);
const zip = (k: string[], v: number[]) => Object.fromEntries(k.map((l, i) => [l, v[i]]));
const gauss = () => {
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
};
