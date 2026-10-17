import { NextRequest, NextResponse } from "next/server";
import { hasChain } from "@/lib/chain";
import { requirements, verifyAndSettle } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Paid resource: one agent decision cycle. Without X-PAYMENT it answers 402 with
 * x402 payment requirements; with a valid payment it settles on Fuji and grants the cycle.
 */
export async function GET(req: NextRequest) {
  if (!hasChain()) return NextResponse.json({ error: "Fuji wallet not configured" }, { status: 503 });
  const r = requirements(req.nextUrl.toString());
  const header = req.headers.get("X-PAYMENT");
  if (!header) return NextResponse.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [r] }, { status: 402 });
  try {
    const s = await verifyAndSettle(header, r);
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: s.txHash, network: r.network, payer: s.payer, amount: s.amount })).toString("base64");
    return NextResponse.json({ ok: true, cycle: "granted", txHash: s.txHash }, { headers: { "X-PAYMENT-RESPONSE": receipt } });
  } catch (e) {
    return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts: [r] }, { status: 402 });
  }
}
