import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, closePosition, getAccountConfig, notionalToContracts, placeOrder, setLeverage, getTicker } from "@/lib/okx";

export const dynamic = "force-dynamic";

/** body: { action: "place" | "cancel" | "close" | "leverage", ... } */
export async function POST(req: NextRequest) {
  const b = await req.json();
  try {
    if (b.action === "cancel") return NextResponse.json(await cancelOrder(b.instId, b.ordId));
    if (b.action === "close") return NextResponse.json(await closePosition(b.instId));
    if (b.action === "leverage") return NextResponse.json(await setLeverage(b.instId, Number(b.lever)));

    // place: size is given in USDT notional and converted to contracts
    const side: "buy" | "sell" = b.side;
    const lever = Number(b.lever ?? 3);
    const cfg = await getAccountConfig();
    const hedge = cfg.posMode === "long_short_mode";
    await setLeverage(b.instId, lever).catch(() => null);
    const px = b.ordType === "limit" ? Number(b.px) : Number((await getTicker(b.instId)).last);
    const sz = await notionalToContracts(b.instId, Number(b.notional), px);
    const res = await placeOrder({
      instId: b.instId,
      side,
      ordType: b.ordType,
      sz,
      px: b.ordType === "limit" ? String(b.px) : undefined,
      posSide: hedge ? (side === "buy" ? "long" : "short") : undefined,
      tpTriggerPx: b.tp ? String(b.tp) : undefined,
      slTriggerPx: b.sl ? String(b.sl) : undefined,
    });
    return NextResponse.json({ ok: true, sz, res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
