import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { agenticWallet } from "@/lib/wallets";
import { payAndFetch } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Buy a signal with the agentic wallet: a real x402 round trip against the paid endpoint. */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const w = agenticWallet();
  if (!w) return NextResponse.json({ error: "Agentic wallet yok" }, { status: 400 });
  const port = process.env.PORT || "3000";
  const { res, paid } = await payAndFetch(`http://localhost:${port}/api/signal/${id}`, w.pk as Hex);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) return NextResponse.json({ error: (body as { error?: string }).error || `HTTP ${res.status}` }, { status: res.status });
  return NextResponse.json({ ...body, paid });
}
