import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { hasChain, txUrl } from "@/lib/chain";
import { ensureFleet, getAgent, recordSale } from "@/lib/fleet";
import { requirements, verifyAndSettle } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Paid scenario of a listed agent (x402, exact scheme, Fuji USDC).
 * No X-PAYMENT -> 402 with requirements; payTo is the agent's own wallet.
 * Valid payment -> settled on Fuji, then the agent runs a live decision cycle for the
 * buyer with its own model and mandate (plan only, no orders) streamed as NDJSON.
 */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureFleet();
  const { id } = await params;
  const a = getAgent(id);
  if (!a || !a.listing.enabled) return NextResponse.json({ error: "Bu ajan pazarda değil" }, { status: 404 });
  if (!hasChain()) return NextResponse.json({ error: "Facilitator cüzdanı yok" }, { status: 503 });
  const r = requirements(req.nextUrl.toString(), a.listing.priceUsdc, a.chain.wallet, `Aviax scenario · ${a.name} (ERC-8004 #${a.chain.agentId})`);
  const header = req.headers.get("X-PAYMENT");
  if (!header) return NextResponse.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [r] }, { status: 402 });

  let settled: Awaited<ReturnType<typeof verifyAndSettle>>;
  try {
    settled = await verifyAndSettle(header, r);
  } catch (e) {
    return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts: [r] }, { status: 402 });
  }
  recordSale(id, settled.payer, settled.amount, settled.txHash);

  const enc = new TextEncoder();
  const line = (o: unknown) => enc.encode(JSON.stringify(o) + "\n");
  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(line({ type: "log", tone: "ok", tool: "x402", text: `Senaryo ödendi: ${settled.amount} USDC → ${a.name} cüzdanı · ${txUrl(settled.txHash)}` }));
      try {
        for await (const ev of runAgent({
          execute: false,
          universe: a.universe,
          model: a.model,
          validator: a.validator,
          openrouterKey: a.openrouterKey,
          allowed: a.mandate.allowed,
          maxTradeUsdt: a.mandate.maxTradeUsdt,
          minGate: a.mandate.minGate,
          budget: a.budget,
        }))
          controller.enqueue(line(ev));
      } catch (e) {
        controller.enqueue(line({ type: "log", tone: "err", text: (e as Error).message }));
        controller.enqueue(line({ type: "done", ms: 0, verdict: "error" }));
      }
      controller.close();
    },
  });
  const receipt = Buffer.from(JSON.stringify({ success: true, transaction: settled.txHash, network: r.network, payer: settled.payer, amount: settled.amount })).toString("base64");
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-PAYMENT-RESPONSE": receipt, "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE" } });
}
