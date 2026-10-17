import { NextRequest, NextResponse } from "next/server";
import { agentAction, ensureFleet } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureFleet();
  const { id } = await params;
  const { action } = await req.json();
  if (!["start", "pause", "close", "delete", "run"].includes(action)) return NextResponse.json({ error: "bad action" }, { status: 400 });
  try {
    await agentAction(id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
