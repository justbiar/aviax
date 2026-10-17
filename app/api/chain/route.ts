import { NextResponse } from "next/server";
import { FUJI, addrUrl, platformStatus } from "@/lib/chain";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await platformStatus();
    return NextResponse.json({ ...s, contracts: FUJI, platformUrl: s.configured ? addrUrl(s.address) : null });
  } catch (e) {
    return NextResponse.json({ configured: false, error: (e as Error).message });
  }
}
