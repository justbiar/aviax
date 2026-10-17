import { NextRequest, NextResponse } from "next/server";
import { addrUrl, balances } from "@/lib/chain";
import { agenticWallet, createAgenticWallet, removeAgenticWallet } from "@/lib/wallets";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Agentic wallet status (address + Fuji balances). The private key never leaves the server. */
export async function GET() {
  const w = agenticWallet();
  if (!w) return NextResponse.json({ agentic: null });
  const b = await balances(w.address).catch(() => ({ avax: 0, usdc: 0 }));
  return NextResponse.json({ agentic: { address: w.address, createdAt: w.createdAt, url: addrUrl(w.address), ...b } });
}

export async function POST(req: NextRequest) {
  const { action } = await req.json();
  if (action === "create") {
    const w = createAgenticWallet();
    return NextResponse.json({ agentic: { address: w.address, createdAt: w.createdAt, url: addrUrl(w.address), avax: 0, usdc: 0 } });
  }
  if (action === "remove") {
    removeAgenticWallet();
    return NextResponse.json({ agentic: null });
  }
  return NextResponse.json({ error: "bad action" }, { status: 400 });
}
