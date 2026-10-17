import { NextRequest, NextResponse } from "next/server";
import type { Hex } from "viem";
import { getCompanySession, getCompanySessionId, historyKey } from "@/lib/companySession";
import { board, COMMISSION_PCT, DEMO_HIRE_CAP, hireLog, recordHire, releaseHire, totalHires } from "@/lib/board";
import { ensureFleet, getAgent, listAgents } from "@/lib/fleet";
import { agenticWallet } from "@/lib/wallets";
import { payAndFetch } from "@/lib/x402";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Platform-run agents (created on the host with the agentic operator) are "Aviax service agents". */
const isPlatform = (a: { chain: { funding?: string } }) => a.chain.funding === "agentic";

function companyKey(req: NextRequest) {
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  if (!session && req.headers.get("x-aviax-public") === "1") return { key: null, session };
  return { key: historyKey(session), session };
}

export async function GET(req: NextRequest) {
  ensureFleet();
  const { key, session } = companyKey(req);
  if (!key) return NextResponse.json({ connected: false, members: [], market: [], commissionPct: COMMISSION_PCT });
  const agents = listAgents();
  const members = board(key);
  const hired = new Set(members.map((m) => m.agentId));
  const companyName = session?.companyName ?? "Aviax Yapım İşleri LTD ŞTİ";
  // The company's own risk desk is always on the board as in-house staff.
  const desk = agents.find((a) => a.decisionOnly && a.companyName === companyName && a.chain.agentId);
  const market = agents
    .filter((a) => !a.decisionOnly && a.listing?.enabled && a.chain.status === "registered" && !hired.has(a.id))
    .map((a) => ({
      id: a.id,
      name: a.name,
      erc8004: a.chain.agentId,
      model: a.model,
      validator: a.validator,
      priceUsdc: a.listing.priceUsdc,
      sales: a.listing.sales,
      trades: a.trades.length,
      wins: a.trades.filter((t) => (t.pnl ?? 0) > 0).length,
      platform: isPlatform(a),
      skills: ["spot trade kararları", "parite · yön · boyut · TP/SL", "risk kapısı"],
    }));
  const log = hireLog(key);
  return NextResponse.json({
    connected: true,
    companyName,
    commissionPct: COMMISSION_PCT,
    inHouse: desk ? [{ id: desk.id, name: desk.name, erc8004: desk.chain.agentId, role: "Risk komitesi · otonom yürütme" }] : [],
    members,
    market,
    totals: {
      hires: log.length,
      spentUsdc: Number(log.reduce((t, h) => t + h.priceUsdc, 0).toFixed(6)),
      commissionUsdc: Number(log.reduce((t, h) => t + h.commissionUsdc, 0).toFixed(6)),
    },
  });
}

export async function POST(req: NextRequest) {
  ensureFleet();
  const { key, session } = companyKey(req);
  if (!key) return NextResponse.json({ error: "Önce demoya geç veya şirketini bağla" }, { status: 401 });
  let body: { action?: string; id?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  const a = body.id ? getAgent(body.id) : null;
  if (!a) return NextResponse.json({ error: "Ajan bulunamadı" }, { status: 404 });

  if (body.action === "release") {
    releaseHire(key, a.id);
    return NextResponse.json({ ok: true });
  }
  if (body.action !== "hire") return NextResponse.json({ error: "Bilinmeyen işlem" }, { status: 400 });
  if (board(key).some((m) => m.agentId === a.id)) return NextResponse.json({ error: "Bu ajan zaten kadroda" }, { status: 409 });
  if (session && !session.demo) return NextResponse.json({ error: "Kendi şirket cüzdanınla kiralama bir sonraki sürümde; demo ve sahip modu agentic cüzdanla öder." }, { status: 400 });
  if (session?.demo && totalHires(key) >= DEMO_HIRE_CAP) return NextResponse.json({ error: "Demo kiralama sınırı doldu" }, { status: 429 });
  const w = agenticWallet();
  if (!w) return NextResponse.json({ error: "Şirket cüzdanı (agentic wallet) yok" }, { status: 400 });

  // A real x402 round trip: 402 -> EIP-3009 signature by the company wallet -> settlement on Fuji.
  const port = process.env.PORT || "3000";
  const { res, paid } = await payAndFetch(`http://localhost:${port}/api/board/hire/${a.id}`, w.pk as Hex);
  const j = (await res.json().catch(() => ({}))) as { ok?: boolean; tx?: string; payer?: string; amount?: number; error?: string };
  if (!res.ok || !j.ok || !j.tx) return NextResponse.json({ error: j.error || `Ödeme başarısız (HTTP ${res.status})` }, { status: 402 });
  const hire = recordHire(key, {
    agentId: a.id,
    name: a.name,
    erc8004: a.chain.agentId,
    role: "Trade komitesi · spot kararları",
    priceUsdc: j.amount ?? a.listing.priceUsdc,
    tx: j.tx,
    payer: j.payer ?? paid?.payer ?? w.address,
    hiredAt: Date.now(),
  });
  return NextResponse.json({ ok: true, hire });
}
