import { NextRequest, NextResponse } from "next/server";
import { balances } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const a = req.nextUrl.searchParams.get("address") ?? "";
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) return NextResponse.json({ error: "bad address" }, { status: 400 });
  try {
    return NextResponse.json(await balances(a as `0x${string}`));
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 });
  }
}
