import fs from "node:fs";
import path from "node:path";
import type { DecisionRecord, RiskEvent } from "./riskDesk";

/**
 * Vote history for the risk desk: every round stores each model's vote next to the joint
 * decision, the deterministic rule check and the portfolio value, so people can see what
 * happened, which model was right and position their agents accordingly.
 * Kept per company key (owner, shared jury demo, or a company session) in data/decisions.json.
 */

export type Vote = {
  modelId: string;
  seat: "primary" | "second" | "advisor";
  verdict: string;
  verdictP: number;
  action: string | null;
  /** model's "a hard limit is breached" probability; null for advisors (not asked) */
  breachP: number | null;
  latencyMs: number;
};

export type HistoryEntry = {
  id: string;
  ts: number;
  hash: string;
  companyName: string;
  total: number;
  breaches: string[];
  verdict: DecisionRecord["verdict"];
  verdictConfidence: number;
  riskLevel: string;
  action: string;
  cut: string;
  orders: number;
  sellUsd: number;
  approval: boolean;
  votes: Vote[];
};

export type ModelScore = {
  modelId: string;
  seat: Vote["seat"];
  votes: number;
  /** share of rounds where the model's top verdict equals the joint verdict */
  withDecision: number;
  /** share of rounds where "breach yes/no" matches the deterministic limit check */
  ruleAccuracy: number | null;
  avgConfidence: number;
  avgLatencyMs: number;
  lastVote: string;
};

const FILE = path.join(process.cwd(), "data", "decisions.json");
const MAX = 400;
const g = globalThis as typeof globalThis & { __aviaxHistory?: Record<string, HistoryEntry[]> };

function store() {
  if (!g.__aviaxHistory) {
    try {
      g.__aviaxHistory = JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      g.__aviaxHistory = {};
    }
  }
  return g.__aviaxHistory!;
}

let saveTimer: NodeJS.Timeout | undefined;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try {
      fs.mkdirSync(path.dirname(FILE), { recursive: true });
      fs.writeFileSync(FILE, JSON.stringify(store()));
    } catch {
      /* history is best-effort */
    }
  }, 500);
}

const top = (d: Record<string, number> | undefined) => {
  const e = Object.entries(d ?? {}).sort((a, b) => b[1] - a[1])[0];
  return e ? { k: e[0], p: e[1] } : null;
};

/** Builds an entry from one round's events and appends it under the company key. */
export function recordRound(key: string, events: RiskEvent[]) {
  const decision = events.find((e) => e.type === "decision") as Extract<RiskEvent, { type: "decision" }> | undefined;
  const models = events.find((e) => e.type === "models") as Extract<RiskEvent, { type: "models" }> | undefined;
  const portfolio = events.find((e) => e.type === "portfolio") as Extract<RiskEvent, { type: "portfolio" }> | undefined;
  const checks = events.find((e) => e.type === "checks") as Extract<RiskEvent, { type: "checks" }> | undefined;
  if (!decision || !models) return;
  const r = decision.record;
  const votes: Vote[] = models.models.map((m) => {
    const seat = m.seat === "primary" ? "primary" : "second";
    const pick = (k: string) => (seat === "primary" ? models.answers[k]?.primary : models.answers[k]?.second ?? undefined) ?? undefined;
    const v = top(pick("verdict"));
    return { modelId: m.modelId, seat, verdict: v?.k ?? "-", verdictP: v?.p ?? 0, action: top(pick("action"))?.k ?? null, breachP: pick("breach")?.yes ?? null, latencyMs: m.latencyMs };
  });
  for (const a of models.reviewers.filter((x) => x.source === "live" && !x.cached)) {
    const v = top(a.answers.verdict);
    votes.push({ modelId: a.modelId.replace(/^openrouter:/, "").replace(/:free$/, ""), seat: "advisor", verdict: v?.k ?? "-", verdictP: v?.p ?? 0, action: top(a.answers.action)?.k ?? null, breachP: null, latencyMs: a.latencyMs });
  }
  const entry: HistoryEntry = {
    id: r.id,
    ts: r.ts,
    hash: r.hash,
    companyName: r.companyName,
    total: portfolio?.total ?? 0,
    breaches: checks?.checks.filter((c) => c.status === "breach").map((c) => c.key) ?? [],
    verdict: r.verdict,
    verdictConfidence: r.verdictConfidence,
    riskLevel: r.riskLevel,
    action: r.action,
    cut: r.cut,
    orders: r.orders.length,
    sellUsd: r.sellUsd,
    approval: r.approval.required,
    votes,
  };
  const s = store();
  const list = (s[key] ??= []);
  list.push(entry);
  if (list.length > MAX) list.splice(0, list.length - MAX);
  save();
}

export function history(key: string, limit = 60) {
  const list = store()[key] ?? [];
  const entries = list.slice(-limit).reverse();
  const by = new Map<string, { seat: Vote["seat"]; n: number; agree: number; ruleN: number; ruleOk: number; conf: number; lat: number; last: string }>();
  for (const e of list) {
    for (const v of e.votes) {
      const k = `${v.seat}:${v.modelId}`;
      const m = by.get(k) ?? { seat: v.seat, n: 0, agree: 0, ruleN: 0, ruleOk: 0, conf: 0, lat: 0, last: "-" };
      m.n++;
      if (v.verdict === e.verdict) m.agree++;
      if (v.breachP !== null) {
        m.ruleN++;
        if ((v.breachP >= 0.5) === e.breaches.length > 0) m.ruleOk++;
      }
      m.conf += v.verdictP;
      m.lat += v.latencyMs;
      m.last = v.verdict;
      by.set(k, m);
    }
  }
  const scores: ModelScore[] = [...by.entries()].map(([k, m]) => ({
    modelId: k.slice(k.indexOf(":") + 1),
    seat: m.seat,
    votes: m.n,
    withDecision: m.agree / m.n,
    ruleAccuracy: m.ruleN ? m.ruleOk / m.ruleN : null,
    avgConfidence: m.conf / m.n,
    avgLatencyMs: m.lat / m.n,
    lastVote: m.last,
  }));
  const order = { primary: 0, second: 1, advisor: 2 } as const;
  scores.sort((a, b) => order[a.seat] - order[b.seat] || b.votes - a.votes);
  return { entries, scores, total: list.length };
}
