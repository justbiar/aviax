import { NextRequest, NextResponse } from "next/server";
import { createAgent, listAgents } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listAgents());
}

const num = (v: unknown, d: number, min: number, max: number) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

export async function POST(req: NextRequest) {
  const b = await req.json();
  const budget = Number(b.budget);
  if (!b.name || !Number.isFinite(budget) || budget < 10) return NextResponse.json({ error: "İsim ve en az 10 USDT bütçe gerekli" }, { status: 400 });
  const model = String(b.model || "ollama:strands-decider");
  if (model.startsWith("openrouter:") && !b.openrouterKey && !process.env.OPENROUTER_API_KEY) return NextResponse.json({ error: "OpenRouter modeli için API anahtarı gerekli" }, { status: 400 });
  const m = b.mandate ?? {};
  const a = createAgent({
    name: String(b.name).slice(0, 24),
    model,
    validator: String(b.validator || "ollama:laya"),
    openrouterKey: b.openrouterKey ? String(b.openrouterKey).trim() : undefined,
    execution: b.execution === "okx" ? "okx" : "paper",
    budget,
    intervalSec: num(b.intervalSec, 300, 30, 86400),
    maxLeverage: 1,
    universe: num(b.universe, 6, 3, 8),
    maxHoldMin: num(b.maxHoldMin, 240, 5, 10080),
    mandate: {
      allowed: Array.isArray(m.allowed) ? m.allowed.map(String).slice(0, 20) : [],
      maxTradeUsdt: num(m.maxTradeUsdt, budget, 5, budget),
      maxDailyTrades: num(m.maxDailyTrades, 10, 1, 500),
      maxDrawdownPct: num(m.maxDrawdownPct, 15, 1, 100),
      minGate: num(m.minGate, 0.55, 0.5, 0.95),
    },
    launchOnFuji: b.launchOnFuji !== false,
  });
  return NextResponse.json({ id: a.id, chain: a.chain.status });
}
