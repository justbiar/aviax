import { NextResponse } from "next/server";
import { getAlgoOrders, getBalance, getOpenOrders, getOrderHistory, getPositions, hasOkxKeys } from "@/lib/okx";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!hasOkxKeys()) return NextResponse.json({ configured: false });
  const settle = async <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e: Error) => ({ ok: false as const, e: e.message }));
  const [balance, positions, orders, algos, history] = await Promise.all([
    settle(getBalance()),
    settle(getPositions()),
    settle(getOpenOrders()),
    settle(getAlgoOrders()),
    settle(getOrderHistory()),
  ]);
  const pick = <T,>(r: { ok: true; v: T } | { ok: false; e: string }, d: T) => (r.ok ? r.v : d);
  const errors = [balance, positions, orders, algos, history].filter((r) => !r.ok).map((r) => (r as { e: string }).e);
  return NextResponse.json({
    configured: true,
    balance: pick(balance, null),
    positions: pick(positions, []).filter((p) => Number(p.pos) !== 0),
    orders: pick(orders, []),
    algos: pick(algos, []),
    history: pick(history, []),
    errors: [...new Set(errors)],
  });
}
