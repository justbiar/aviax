import { NextRequest } from "next/server";
import { DEFAULT_POLICY, runRiskDesk, type Policy, type Shock, type Source } from "@/lib/riskDesk";
import { getCompanySession, getCompanySessionId, historyKey } from "@/lib/companySession";
import { recordRound } from "@/lib/decisionHistory";
import type { RiskEvent } from "@/lib/riskDesk";

export const runtime = "nodejs";


export async function POST(req: NextRequest) {
  let body: { source?: Source; shock?: Shock; policy?: Policy; companyName?: string; request?: string; reviewers?: string[]; execute?: boolean };
  try { body = await req.json(); } catch { return Response.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const source = body.source ?? "fund";
  const shock = body.shock ?? "none";
  if (!["okx", "fund", "dao"].includes(source) || !["none", "market10", "avax30", "crash40"].includes(shock)) return Response.json({ error: "Geçersiz portföy veya stres senaryosu" }, { status: 400 });
  const companyName = (body.companyName ?? "Şirket hazinesi").trim().slice(0, 64) || "Şirket hazinesi";
  const reviewers = [...new Set((Array.isArray(body.reviewers) ? body.reviewers : []).filter((m): m is string => typeof m === "string" && m.startsWith("openrouter:") && (m.endsWith(":free") || m === "openrouter:openrouter/free")))].slice(0, 2);
  const isPublic = req.headers.get("x-aviax-public") === "1";
  const sessionId = getCompanySessionId(req.headers.get("cookie"));
  const companySession = getCompanySession(sessionId);
  // Localhost is the owner: without a company session it reads the host .env demo account. Visitors must connect their own.
  if (source === "okx" && !companySession && isPublic) return Response.json({ error: "Önce kendi OKX demo şirket hesabını bağla." }, { status: 401 });
  const policy = { ...DEFAULT_POLICY, ...(companySession?.riskPolicy ?? {}), ...(body.policy ?? {}) };
  if (Object.values(policy).some((v) => !Number.isFinite(v) || v < 0)) return Response.json({ error: "Politika değerleri geçersiz" }, { status: 400 });
  if ([policy.maxWeight, policy.maxDrawdown, policy.minReserve, policy.maxVol].some((v) => v > 100)) return Response.json({ error: "Yüzde limitleri 100'ü aşamaz" }, { status: 400 });
  if (policy.approvalUsd > 1_000_000_000) return Response.json({ error: "Onay eşiği çok yüksek" }, { status: 400 });
  const seats = companySession?.model === "openrouter"
    ? { primary: companySession.modelSpec ?? "openrouter:openrouter/free", second: "" }
    : companySession?.model === "local"
      ? { primary: companySession.modelSpec ?? "ollama:strands-decider", second: companySession.secondModelSpec ?? "" }
      : undefined;
  const activeReviewers = companySession?.model === "local" ? [] : reviewers;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const round: RiskEvent[] = [];
      try {
        for await (const event of runRiskDesk({ source, shock, policy, companyName, request: body.request?.trim() || undefined, reviewers: activeReviewers, execute: body.execute !== false, ...(companySession ? { okxCredentials: companySession.okx, openrouterKey: companySession.openrouterKey, seats } : {}) })) {
          if (event.type !== "stage") round.push(event);
          controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
        }
        if (source === "okx" && shock === "none") recordRound(historyKey(companySession), round);
      } catch (e) {
        controller.enqueue(encoder.encode(`${JSON.stringify({ type: "error", text: e instanceof Error ? e.message : "Risk analizi başarısız" })}\n`));
      } finally {
        controller.close();
      }
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" } });
}
