import { NextRequest, NextResponse } from "next/server";
import { getCompanySession, getCompanySessionId, updateCompanySession } from "@/lib/companySession";
import { createAgent, ensureFleet, getAgent, agentAction, type NewAgent } from "@/lib/fleet";
import { addrUrl, balances, mandateHash } from "@/lib/chain";
import { DEFAULT_POLICY } from "@/lib/riskDesk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function publicAgent(id: string | undefined) {
  if (!id) return null;
  const agent = getAgent(id);
  if (!agent) return null;
  return {
    id: agent.id,
    name: agent.name,
    status: agent.chain.status,
    wallet: agent.chain.wallet,
    agentId: agent.chain.agentId,
    error: agent.chain.error,
    log: agent.chain.log.slice(0, 8),
    explorer: addrUrl(agent.chain.wallet),
  };
}

export async function GET(req: NextRequest) {
  ensureFleet();
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  if (!session) return NextResponse.json({ connected: false });
  const agent = publicAgent(session.companyAgentId);
  if (!agent) return NextResponse.json({ connected: true, agent: null });
  const balance = await balances(agent.wallet as `0x${string}`).catch(() => ({ avax: 0, usdc: 0 }));
  return NextResponse.json({ connected: true, agent, balance });
}

export async function POST(req: NextRequest) {
  const id = getCompanySessionId(req.headers.get("cookie"));
  const session = getCompanySession(id);
  if (!session || !id) return NextResponse.json({ error: "Önce şirket hesabını bağla" }, { status: 401 });
  if (session.demo) return NextResponse.json({ error: "Demo hesabında Fuji kaydı kapalı. Kendi şirketini bağlayarak kayıt açabilirsin." }, { status: 403 });

  let existing = publicAgent(session.companyAgentId);
  if (existing) {
    if (existing.status === "failed") await agentAction(existing.id, "launch");
    return NextResponse.json({ agent: existing, reused: true });
  }

  const policy = session.riskPolicy ?? DEFAULT_POLICY;
  const companyPolicyHash = mandateHash(policy) as `0x${string}`;
  const model = session.model === "openrouter" ? session.modelSpec ?? "openrouter:openrouter/free" : session.model === "local" ? session.modelSpec ?? "ollama:strands-decider" : "ollama:strands-decider";
  const validator = session.model === "local" ? session.secondModelSpec ?? "ollama:laya" : "ollama:laya";
  const input: NewAgent = {
    name: `${session.companyName.slice(0, 17)} Risk`,
    model,
    validator,
    // This identity-only agent never calls the trading scheduler; avoid copying BYOK keys into fleet storage.
    openrouterKey: undefined,
    mandate: { allowed: [], maxTradeUsdt: 10, maxDailyTrades: 1, maxDrawdownPct: policy.maxDrawdown, minGate: 0.6 },
    execution: "paper",
    budget: 10,
    intervalSec: 86_400,
    maxLeverage: 1,
    universe: 3,
    maxHoldMin: 1440,
    launchOnFuji: true,
    funding: "browser",
    owner: session.payoutAddress,
    decisionOnly: true,
    companyName: session.companyName,
    companyPolicyHash,
    companyDecisionEndpoint: `/api/company/decision/${session.publicId}`,
  };
  const agent = createAgent(input);
  updateCompanySession(id, { companyAgentId: agent.id });
  return NextResponse.json({ agent: publicAgent(agent.id), reused: false });
}
