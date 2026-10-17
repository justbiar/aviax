import { NextRequest, NextResponse } from "next/server";
import { ask, recordHash, type Seats } from "@/lib/decisionLayer";
import type { Question } from "@/lib/decide";

/** Generic decision-model endpoint for agents and integrations. */
export async function POST(req: NextRequest) {
  if (req.headers.get("x-aviax-public") === "1") return NextResponse.json({ error: "Ücretli JEV sorguları için şirketin x402 endpoint'ini kullan." }, { status: 403 });
  try {
    const body = await req.json() as { state?: string; questions?: Record<string, Question>; seats?: Seats; strict?: boolean };
    if (typeof body.state !== "string" || !body.state.trim()) return NextResponse.json({ error: "state zorunlu" }, { status: 400 });
    if (!body.questions || typeof body.questions !== "object" || !Object.keys(body.questions).length) return NextResponse.json({ error: "questions zorunlu" }, { status: 400 });
    const result = await ask(body.state, body.questions, body.seats, { strict: body.strict ?? true });
    return NextResponse.json({ ...result, decisionHash: recordHash({ state: body.state, questions: body.questions, result }) });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Decision modeli yanıt vermedi" }, { status: 503 });
  }
}
