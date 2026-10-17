import { NextRequest, NextResponse } from "next/server";
import { getCandles, getOrderbook, getTicker, getTickers, getTrades, getFundingRate } from "@/lib/okx";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const kind = p.get("kind");
  const instId = p.get("instId") ?? "BTC-USDT-SWAP";
  try {
    switch (kind) {
      case "tickers":
        return NextResponse.json(await getTickers("SWAP"));
      case "ticker":
        return NextResponse.json(await getTicker(instId));
      case "candles":
        return NextResponse.json(await getCandles(instId, p.get("bar") ?? "15m", Number(p.get("limit") ?? 300)));
      case "book":
        return NextResponse.json(await getOrderbook(instId, 15));
      case "trades":
        return NextResponse.json(await getTrades(instId, 25));
      case "funding":
        return NextResponse.json(await getFundingRate(instId));
      default:
        return NextResponse.json({ error: "unknown kind" }, { status: 400 });
    }
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
