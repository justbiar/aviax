import { NextRequest, NextResponse } from "next/server";
import { getCompanySession, getCompanySessionId } from "@/lib/companySession";
import { getBalance, getOpenOrders, getOrderHistory } from "@/lib/okx";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  if (!session) return NextResponse.json({ connected: false });
  const collect = async <T,>(promise: Promise<T>) => promise.then((value) => ({ ok: true as const, value })).catch((error: Error) => ({ ok: false as const, error: error.message }));
  const [balance, openOrders, history] = await Promise.all([
    collect(getBalance(session.okx)),
    collect(getOpenOrders(session.okx)),
    collect(getOrderHistory(session.okx)),
  ]);
  const errors = [balance, openOrders, history].flatMap((result) => result.ok ? [] : [result.error]);
  return NextResponse.json({
    connected: balance.ok,
    companyName: session.companyName,
    balance: balance.ok ? balance.value : null,
    assets: balance.ok ? balance.value.details.filter((asset) => Number(asset.eq) > 0) : [],
    orders: openOrders.ok ? openOrders.value : [],
    history: history.ok ? history.value : [],
    errors,
  }, { status: balance.ok ? 200 : 401 });
}
