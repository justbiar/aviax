import { NextRequest, NextResponse } from "next/server";
import { createAgent, listAgents } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listAgents());
}

export async function POST(req: NextRequest) {
  const b = await req.json();
  const budget = Number(b.budget);
  if (!b.name || !Number.isFinite(budget) || budget < 10) return NextResponse.json({ error: "İsim ve en az 10 USDT bütçe gerekli" }, { status: 400 });
  const a = createAgent({
    name: String(b.name).slice(0, 24),
    model: String(b.model || "shadow"),
    execution: b.execution === "okx" ? "okx" : "paper",
    budget,
    intervalSec: Math.max(30, Number(b.intervalSec) || 300),
    maxLeverage: Math.min(Number(process.env.AGENT_MAX_LEVERAGE || 5), Math.max(1, Number(b.maxLeverage) || 3)),
    universe: Math.min(8, Math.max(3, Number(b.universe) || 6)),
    maxHoldMin: Math.max(5, Number(b.maxHoldMin) || 240),
  });
  return NextResponse.json({ id: a.id });
}
