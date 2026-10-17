import { NextRequest, NextResponse } from "next/server";
import { DEFAULT_POLICY, type Policy } from "@/lib/riskDesk";
import { getCompanySession, getCompanySessionId, updateCompanySession } from "@/lib/companySession";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const safeSettings = (session: NonNullable<ReturnType<typeof getCompanySession>>) => ({
  connected: true,
  companyName: session.companyName,
  payoutAddress: session.payoutAddress,
  model: session.model,
  modelSpec: session.modelSpec,
  secondModelSpec: session.secondModelSpec,
  riskPolicy: session.riskPolicy ?? DEFAULT_POLICY,
  companyAgentId: session.companyAgentId,
});

export async function GET(req: NextRequest) {
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  return NextResponse.json(session ? safeSettings(session) : { connected: false });
}

export async function POST(req: NextRequest) {
  const id = getCompanySessionId(req.headers.get("cookie"));
  const session = getCompanySession(id);
  if (!session || !id) return NextResponse.json({ error: "Önce şirket OKX hesabını bağla" }, { status: 401 });

  let body: { model?: string; modelSpec?: string; secondModelSpec?: string; openrouterKey?: string; riskPolicy?: Policy };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }

  const model = body.model === "local" || body.model === "openrouter" ? body.model : body.model === "ours" ? "ours" : session.model;
  const modelSpec = body.modelSpec?.trim() || session.modelSpec;
  const secondModelSpec = body.secondModelSpec?.trim() || undefined;
  const submittedKey = body.openrouterKey?.trim();
  if (model === "local" && (!modelSpec || !/^ollama:[a-zA-Z0-9._:-]+$/.test(modelSpec))) return NextResponse.json({ error: "Ana yerel Ollama modelini seç veya ollama:model-adı biçiminde gir" }, { status: 400 });
  if (model === "local" && secondModelSpec && !/^ollama:[a-zA-Z0-9._:-]+$/.test(secondModelSpec)) return NextResponse.json({ error: "İkinci yerel model geçersiz" }, { status: 400 });
  if (model === "openrouter" && (!modelSpec || !/^openrouter:[a-zA-Z0-9._/-]+(?::free)?$/.test(modelSpec))) return NextResponse.json({ error: "OpenRouter modelini seç" }, { status: 400 });
  if (model === "openrouter" && (submittedKey ? submittedKey.length < 12 || submittedKey.length > 256 : (session.openrouterKey?.length ?? 0) < 12)) return NextResponse.json({ error: "OpenRouter anahtarını gir veya kayıtlı anahtarı kullan" }, { status: 400 });
  if (submittedKey && submittedKey.length > 256) return NextResponse.json({ error: "OpenRouter anahtarı çok uzun" }, { status: 400 });

  const p = body.riskPolicy ?? session.riskPolicy ?? DEFAULT_POLICY;
  if (Object.values(p).some((v) => !Number.isFinite(v) || v < 0) || [p.maxWeight, p.maxDrawdown, p.minReserve, p.maxVol].some((v) => v > 100) || p.approvalUsd > 1_000_000_000) return NextResponse.json({ error: "Risk sınırlarını kontrol et" }, { status: 400 });

  const updated = updateCompanySession(id, {
    model,
    modelSpec: modelSpec as typeof session.modelSpec,
    secondModelSpec: secondModelSpec as typeof session.secondModelSpec,
    ...(submittedKey ? { openrouterKey: submittedKey } : {}),
    riskPolicy: p,
  });
  return NextResponse.json(updated ? safeSettings(updated) : { error: "Şirket oturumu sona erdi" }, { status: updated ? 200 : 401 });
}
