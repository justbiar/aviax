import { NextRequest, NextResponse } from "next/server";
import { agentAction, ensureFleet, setListing } from "@/lib/fleet";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  ensureFleet();
  const { id } = await params;
  const body = await req.json();
  const { action } = body;
  if (action === "list" || action === "unlist") {
    if (req.headers.get("x-aviax-public") === "1") return NextResponse.json({ error: "Pazara açma sadece ajan sahibinin makinesinden" }, { status: 403 });
    try {
      setListing(id, action === "list", body.priceUsdc !== undefined ? Number(body.priceUsdc) : undefined);
      return NextResponse.json({ ok: true });
    } catch (e) {
      return NextResponse.json({ error: (e as Error).message }, { status: 400 });
    }
  }
  if (action === "launch" && req.headers.get("x-aviax-public") === "1") return NextResponse.json({ error: "Fuji kaydı sadece sunum makinesinden yapılır" }, { status: 403 });
  if (!["start", "pause", "close", "delete", "run", "launch"].includes(action)) return NextResponse.json({ error: "bad action" }, { status: 400 });
  try {
    await agentAction(id, action);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 404 });
  }
}
