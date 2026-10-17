import { NextRequest, NextResponse } from "next/server";
import { ensureFleet, getEvents } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureFleet();
  const { id } = await params;
  const since = Number(req.nextUrl.searchParams.get("since") ?? 0);
  const r = getEvents(id, since);
  return r ? NextResponse.json(r) : NextResponse.json({ error: "not found" }, { status: 404 });
}
