import { NextRequest, NextResponse } from "next/server";
import { cancelOrder, getTicker, placeOrder, roundLot, roundToTick } from "@/lib/okx";

export const dynamic = "force-dynamic";

/**
 * Spot orders. body: { action: "place" | "cancel", ... }
 * place: { instId, side, ordType, notional (USDT), px?, tp?, sl? }
 */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-aviax-public") === "1") return NextResponse.json({ ok: false, error: "Herkese açık demo üzerinden OKX emri gönderilemez. Şirket analiz kurulumu salt okunur." }, { status: 403 });
  const b = await req.json();
  try {
    if (b.action === "cancel") return NextResponse.json(await cancelOrder(b.instId, b.ordId));

    const side: "buy" | "sell" = b.side;
    const notional = Number(b.notional);
    if (!(notional > 0)) throw new Error("Tutar girilmeli");
    let sz: string;
    let tgtCcy: "base_ccy" | "quote_ccy" | undefined;
    let px: string | undefined;
    if (b.ordType === "market") {
      sz = String(notional);
      tgtCcy = "quote_ccy";
    } else {
      px = await roundToTick(b.instId, Number(b.px || (await getTicker(b.instId)).last));
      sz = await roundLot(b.instId, notional / Number(px));
    }
    const res = await placeOrder({
      instId: b.instId,
      side,
      ordType: b.ordType,
      sz,
      px,
      tdMode: "cash",
      tgtCcy,
      // TP/SL can only protect a buy on spot.
      tpTriggerPx: side === "buy" && b.tp ? String(b.tp) : undefined,
      slTriggerPx: side === "buy" && b.sl ? String(b.sl) : undefined,
    });
    return NextResponse.json({ ok: true, sz, res });
  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message }, { status: 400 });
  }
}
