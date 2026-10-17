import { NextRequest, NextResponse } from "next/server";
import { ask, recordHash } from "@/lib/decisionLayer";
import type { Question } from "@/lib/decide";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Free A2MCP service for OKX.AI: any agent sends { state, questions } and gets the decision of
 * two local decision models (strands-decider + laya) as probability distributions, plus a
 * record hash. Fixed seats (no model choice from callers), bounded input, live answers only.
 */

const SERVICE = {
  name: "Aviax Decision",
  provider: "Aviax (aviax.pages.dev)",
  description:
    "Decision-model layer for agents. Send a state and up to 8 questions (choice, score or noul); two local decision models answer each with a probability distribution in one forward pass. Returns per-model and ensemble distributions, the pick, confidence, model agreement and a keccak256 record hash. No generated text.",
  pricing: "free",
  method: "POST",
  input: {
    state: "string, the situation to decide on (max 4000 chars)",
    questions: {
      "<key>": [
        { type: "choice", instructions: "string", criteria: { "<option>": "description" } },
        { type: "score", instructions: "string", criteria: ["level 0", "level 1", "..."] },
        { type: "noul", instructions: "a statement; returns the probability it is true" },
      ],
    },
  },
  example: {
    state: "Company treasury: BTC 78% of portfolio, policy max single asset 40%, stablecoin reserve 5% (min 20%).",
    questions: {
      intervene: { type: "choice", instructions: "Should the company take a risk action now?", criteria: { yes: "intervene now", no: "hold", uncertain: "defer to a human" } },
      breach: { type: "noul", instructions: "At least one hard policy limit is breached." },
    },
  },
  models: ["strands-decider (1.9B, primary)", "laya (421M, second opinion)"],
  identity: { network: "avalanche-fuji", standard: "ERC-8004", agentId: "271" },
};

export async function GET() {
  return NextResponse.json(SERVICE);
}

export async function POST(req: NextRequest) {
  let body: { state?: unknown; questions?: unknown };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "invalid JSON" }, { status: 400 }); }
  const state = typeof body.state === "string" ? body.state.trim() : "";
  if (!state || state.length > 4000) return NextResponse.json({ error: "state is required (max 4000 chars)" }, { status: 400 });
  if (!body.questions || typeof body.questions !== "object") return NextResponse.json({ error: "questions is required" }, { status: 400 });
  const entries = Object.entries(body.questions as Record<string, Question>);
  if (!entries.length || entries.length > 8) return NextResponse.json({ error: "1 to 8 questions" }, { status: 400 });
  for (const [k, q] of entries) {
    const okType = q && ["choice", "score", "noul"].includes(q.type) && typeof q.instructions === "string";
    const okCriteria = q?.type === "noul" || (q?.type === "choice" && q.criteria && typeof q.criteria === "object" && !Array.isArray(q.criteria)) || (q?.type === "score" && Array.isArray(q.criteria));
    if (!okType || !okCriteria || k.length > 40) return NextResponse.json({ error: `invalid question: ${k}` }, { status: 400 });
  }
  try {
    const questions = Object.fromEntries(entries);
    const result = await ask(state, questions, undefined, { strict: true });
    const answers = Object.fromEntries(Object.entries(result.answers).map(([k, a]) => [k, { pick: a.pick, confidence: a.confidence, agreement: a.agreement, ensemble: a.ensemble, primary: a.primary, second: a.second }]));
    return NextResponse.json({ service: SERVICE.name, answers, models: result.models, decisionHash: recordHash({ state, questions, answers }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "decision models unavailable" }, { status: 503 });
  }
}
