import { NextRequest } from "next/server";
import { getCompanySession, getCompanySessionId, historyKey } from "@/lib/companySession";
import { history } from "@/lib/decisionHistory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Vote history of the caller's company: past rounds and a per-model scoreboard. */
export async function GET(req: NextRequest) {
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  if (!session && req.headers.get("x-aviax-public") === "1") return Response.json({ entries: [], scores: [], total: 0 });
  return Response.json(history(historyKey(session)));
}
