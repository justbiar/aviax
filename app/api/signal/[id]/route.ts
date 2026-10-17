import { NextRequest, NextResponse } from "next/server";
import { hasChain } from "@/lib/chain";
import { ensureFleet, getAgent, latestSignal, recordSale } from "@/lib/fleet";
import { requirements, verifyAndSettle } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Paid signal of a listed agent (x402, exact scheme, Fuji USDC).
 * No X-PAYMENT -> 402 with requirements; payTo is the agent's own wallet.
 * Valid payment -> settled on Fuji, the buyer gets the agent's latest decision.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureFleet();
  const { id } = await params;
  const a = getAgent(id);
  if (!a || !a.listing.enabled) return NextResponse.json({ error: "Bu ajan pazarda değil" }, { status: 404 });
  if (!hasChain()) return NextResponse.json({ error: "Facilitator cüzdanı yok" }, { status: 503 });
  const r = requirements(req.nextUrl.toString(), a.listing.priceUsdc, a.chain.wallet, `Aviax signal · ${a.name} (ERC-8004 #${a.chain.agentId})`);
  const header = req.headers.get("X-PAYMENT");
  if (!header) return NextResponse.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [r] }, { status: 402 });
  try {
    const s = await verifyAndSettle(header, r);
    recordSale(id, s.payer, s.amount, s.txHash);
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: s.txHash, network: r.network, payer: s.payer, amount: s.amount })).toString("base64");
    return NextResponse.json({ ok: true, txHash: s.txHash, signal: latestSignal(id) }, { headers: { "X-PAYMENT-RESPONSE": receipt } });
  } catch (e) {
    return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts: [r] }, { status: 402 });
  }
}
