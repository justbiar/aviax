import { NextRequest, NextResponse } from "next/server";
import { getAlgoOrders, getBalance, getOpenOrders, getOrderHistory, hasOkxKeys } from "@/lib/okx";

export const dynamic = "force-dynamic";

/** One OKX round trip (4 signed calls, ~4 s from TR) shared by every poller for a few seconds. */
const TTL_MS = 3_000;
const cache = globalThis as typeof globalThis & { __acct?: { at: number; p: Promise<unknown> } };

async function load() {
  const settle = async <T,>(p: Promise<T>) => p.then((v) => ({ ok: true as const, v })).catch((e: Error) => ({ ok: false as const, e: e.message }));
  const [balance, orders, algos, history] = await Promise.all([settle(getBalance()), settle(getOpenOrders()), settle(getAlgoOrders()), settle(getOrderHistory())]);
  const pick = <T,>(r: { ok: true; v: T } | { ok: false; e: string }, d: T) => (r.ok ? r.v : d);
  const errors = [balance, orders, algos, history].filter((r) => !r.ok).map((r) => (r as { e: string }).e);
  const bal = pick(balance, null);
  return {
    configured: true,
    balance: bal,
    assets: (bal?.details ?? []).filter((d) => Number(d.eq) > 0),
    orders: pick(orders, []),
    algos: pick(algos, []),
    history: pick(history, []),
    errors: [...new Set(errors)],
  };
}

export async function GET(req: NextRequest) {
  if (req.headers.get("x-aviax-public") === "1") return NextResponse.json({ configured: false, companyAccountRequired: true });
  if (!hasOkxKeys()) return NextResponse.json({ configured: false });
  // Orders placed from the trade page call reload right away; ?fresh=1 skips the shared copy.
  const fresh = req.nextUrl.searchParams.get("fresh") === "1";
  if (fresh || !cache.__acct || Date.now() - cache.__acct.at > TTL_MS) cache.__acct = { at: Date.now(), p: load() };
  return NextResponse.json(await cache.__acct.p);
}
