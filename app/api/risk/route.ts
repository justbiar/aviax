import { createHash } from "node:crypto";
import { NextRequest } from "next/server";
import { DEFAULT_POLICY, runRiskDesk, type Policy, type Shock, type Source } from "@/lib/riskDesk";
import { getCompanySession, getCompanySessionId, historyKey } from "@/lib/companySession";
import { recordRound } from "@/lib/decisionHistory";
import type { RiskEvent } from "@/lib/riskDesk";

export const runtime = "nodejs";

/**
 * Shared rounds: viewers of the same account and policy share one model run instead of each
 * starting their own. A request joins a round in progress, or replays one that finished within
 * SHARE_MS; nobody is turned away, the machine just does the work once.
 */
const SHARE_MS = 8_000;
type Round = { events: RiskEvent[]; done: boolean; at: number; waiters: Set<() => void> };
const rounds = ((globalThis as typeof globalThis & { __riskRounds?: Map<string, Round> }).__riskRounds ??= new Map<string, Round>());

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
  const execute = body.execute !== false;

  // Same account + same inputs = same round. The account is identified by a hash of its API key.
  const account = createHash("sha256").update(companySession?.okx.apiKey ?? process.env.OKX_API_KEY ?? "").digest("hex").slice(0, 16);
  const key = JSON.stringify({ account, source, shock, policy, companyName, reviewers: activeReviewers, seats, execute, request: body.request ?? "" });
  for (const [k, r] of rounds) if (r.done && Date.now() - r.at > SHARE_MS) rounds.delete(k);

  let round = rounds.get(key);
  const owner = !round;
  if (!round) {
    const r: Round = { events: [], done: false, at: Date.now(), waiters: new Set() };
    round = r;
    rounds.set(key, r);
    const push = (e: RiskEvent) => { r.events.push(e); r.waiters.forEach((w) => w()); };
    void (async () => {
      try {
        for await (const event of runRiskDesk({ source, shock, policy, companyName, request: body.request?.trim() || undefined, reviewers: activeReviewers, execute, ...(companySession ? { okxCredentials: companySession.okx, openrouterKey: companySession.openrouterKey, seats } : {}) })) push(event);
        if (source === "okx" && shock === "none") recordRound(historyKey(companySession), r.events.filter((e) => e.type !== "stage"));
      } catch (e) {
        push({ type: "error", text: e instanceof Error ? e.message : "Risk analizi başarısız" });
      } finally {
        r.done = true;
        r.at = Date.now();
        r.waiters.forEach((w) => w());
      }
    })();
  }

  // Stream the round's events to this viewer as they arrive (or replay them if it already finished).
  const shared = round;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let sent = 0;
      while (true) {
        while (sent < shared.events.length) controller.enqueue(encoder.encode(`${JSON.stringify(shared.events[sent++])}\n`));
        if (shared.done) break;
        await new Promise<void>((resolve) => {
          const w = () => { shared.waiters.delete(w); resolve(); };
          shared.waiters.add(w);
          // An event or the end may have landed between the drain above and registering.
          if (sent < shared.events.length || shared.done) w();
        });
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform", "X-Aviax-Round": owner ? "new" : "shared" } });
}
