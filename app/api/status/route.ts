import { NextResponse } from "next/server";
import { isLive, provider } from "@/lib/decide";
import { hasOkxKeys } from "@/lib/okx";
import { hasOpenRouter } from "@/lib/openrouter";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ okx: hasOkxKeys(), demo: process.env.OKX_DEMO !== "0", jev: isLive("jev"), jevProvider: provider("jev"), laya: isLive("laya"), llm: hasOpenRouter() });
}
