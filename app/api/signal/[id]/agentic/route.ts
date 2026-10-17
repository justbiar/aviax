import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { agenticWallet } from "@/lib/wallets";
import { payAndFetch } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Start a scenario paid by the agentic wallet: a real x402 round trip, stream passed through. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = agenticWallet();
  if (!w) return NextResponse.json({ error: "Agentic wallet yok" }, { status: 400 });
  const port = process.env.PORT || "3000";
  const { res } = await payAndFetch(`http://localhost:${port}/api/signal/${id}`, w.pk as Hex);
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    return NextResponse.json({ error: (body as { error?: string }).error || `HTTP ${res.status}` }, { status: res.status });
  }
  return new Response(res.body, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store", "X-PAYMENT-RESPONSE": res.headers.get("X-PAYMENT-RESPONSE") ?? "" } });
}
