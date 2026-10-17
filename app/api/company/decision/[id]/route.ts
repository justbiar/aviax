import { NextRequest, NextResponse } from "next/server";
import { getCompanySessionByPublicId } from "@/lib/companySession";
import { hasChain, txUrl } from "@/lib/chain";
import { ask, recordHash } from "@/lib/decisionLayer";
import type { Question } from "@/lib/decide";
import { requirements, verifyAndSettle } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-PAYMENT", "Access-Control-Expose-Headers": "X-PAYMENT-RESPONSE" };

export async function OPTIONS() { return new Response(null, { status: 204, headers: cors }); }

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = getCompanySessionByPublicId(id);
  if (!company) return NextResponse.json({ error: "Şirket decision endpoint bulunamadı" }, { status: 404, headers: cors });
  if (!hasChain()) return NextResponse.json({ error: "Fuji x402 ödeme servisi şu an kullanılamıyor" }, { status: 503, headers: cors });
  const payment = requirements(req.nextUrl.toString(), company.queryPriceUsdc, company.payoutAddress, "Aviax company decision model query");
  return NextResponse.json({ x402Version: 1, accepts: [payment] }, { status: 402, headers: cors });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const company = getCompanySessionByPublicId(id);
  if (!company) return NextResponse.json({ error: "Şirket decision endpoint bulunamadı" }, { status: 404, headers: cors });
  if (!hasChain()) return NextResponse.json({ error: "Fuji x402 ödeme servisi şu an kullanılamıyor" }, { status: 503, headers: cors });
  const payment = requirements(req.nextUrl.toString(), company.queryPriceUsdc, company.payoutAddress, "Aviax company decision model query");
  const header = req.headers.get("X-PAYMENT");
  if (!header) return NextResponse.json({ x402Version: 1, error: "X-PAYMENT header is required", accepts: [payment] }, { status: 402, headers: cors });
  let body: { state?: string; questions?: Record<string, Question> };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "JSON isteniyor" }, { status: 400, headers: cors }); }
  if (!body.state?.trim() || body.state.length > 24_000 || !body.questions || typeof body.questions !== "object" || Object.keys(body.questions).length < 1 || Object.keys(body.questions).length > 12) return NextResponse.json({ error: "state (24 KB max) ve 1-12 questions gerekli" }, { status: 400, headers: cors });
  let settled: Awaited<ReturnType<typeof verifyAndSettle>>;
  try { settled = await verifyAndSettle(header, payment); }
  catch (e) { return NextResponse.json({ x402Version: 1, error: (e as Error).message, accepts: [payment] }, { status: 402, headers: cors }); }
  try {
    const seats = company.model === "openrouter"
      ? { primary: company.modelSpec ?? "openrouter:openrouter/free", second: "" }
      : company.model === "local"
        ? { primary: company.modelSpec ?? "ollama:strands-decider", second: company.secondModelSpec ?? "" }
        : undefined;
    const result = await ask(body.state, body.questions, seats, { strict: true, openrouterKey: company.openrouterKey });
    const payload = { ...result, decisionHash: recordHash({ state: body.state, questions: body.questions, result }), payment: { network: payment.network, amountUsdc: settled.amount, payer: settled.payer, recipient: company.payoutAddress, txHash: settled.txHash, txUrl: txUrl(settled.txHash) } };
    const receipt = Buffer.from(JSON.stringify({ success: true, transaction: settled.txHash, network: payment.network, payer: settled.payer, amount: settled.amount })).toString("base64");
    return NextResponse.json(payload, { headers: { ...cors, "X-PAYMENT-RESPONSE": receipt, "Cache-Control": "no-store" } });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Karar modeli yanıt vermedi", payment: { amountUsdc: settled.amount, txHash: settled.txHash, txUrl: txUrl(settled.txHash) } }, { status: 503, headers: { ...cors, "Cache-Control": "no-store" } });
  }
}
