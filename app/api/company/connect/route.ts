import { NextRequest, NextResponse } from "next/server";
import { clearCompanySession, getCompanySession, getCompanySessionId, saveCompanySession, type CompanySession } from "@/lib/companySession";
import { getBalance, hasOkxKeys } from "@/lib/okx";
import { hasChain, operatorAccount } from "@/lib/chain";
import { isAddress } from "viem";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const session = getCompanySession(getCompanySessionId(req.headers.get("cookie")));
  if (!session) {
    // Owner mode on localhost: the host's own .env demo account stands in for a company connection.
    if (req.headers.get("x-aviax-public") !== "1" && hasOkxKeys()) return NextResponse.json({ connected: true, owner: true, companyName: "Aviax Yapım İşleri LTD ŞTİ", model: "ours" });
    return NextResponse.json({ connected: false });
  }
  try {
    const balance = await getBalance(session.okx);
    return NextResponse.json({ connected: true, demo: Boolean(session.demo), companyName: session.companyName, total: Number(balance.totalEq), assets: balance.details.filter((a) => Number(a.eq) > 0).length, model: session.model, modelSpec: session.modelSpec, secondModelSpec: session.secondModelSpec, queryPriceUsdc: session.queryPriceUsdc, payoutAddress: session.payoutAddress, riskPolicy: session.riskPolicy, companyAgentId: session.companyAgentId, endpoint: `/api/company/decision/${session.publicId}` });
  } catch {
    return NextResponse.json({ connected: false, error: "OKX demo bağlantısı doğrulanamadı. Bilgileri yeniden gir." }, { status: 401 });
  }
}

export async function POST(req: NextRequest) {
  const previousId = getCompanySessionId(req.headers.get("cookie"));
  let body: { action?: string; companyName?: string; apiKey?: string; secretKey?: string; passphrase?: string; model?: string; modelSpec?: string; secondModelSpec?: string; openrouterKey?: string; queryPriceUsdc?: number; payoutAddress?: string };
  try { body = await req.json(); } catch { return NextResponse.json({ error: "Geçersiz istek" }, { status: 400 }); }
  if (body.action === "demo") {
    // Jury demo: the host's OKX demo account and OpenRouter key, held only on the server.
    if (!hasOkxKeys()) return NextResponse.json({ error: "Demo hesabı bu sunucuda tanımlı değil" }, { status: 503 });
    const okx = { apiKey: process.env.OKX_API_KEY!, secretKey: process.env.OKX_SECRET_KEY!, passphrase: process.env.OKX_PASSPHRASE! };
    try {
      const balance = await getBalance(okx);
      clearCompanySession(previousId);
      const payout = hasChain() ? operatorAccount().address : ("0x000000000000000000000000000000000000dEaD" as const);
      const saved = saveCompanySession({ companyName: "Aviax Yapım İşleri LTD ŞTİ", okx, model: "ours", openrouterKey: process.env.OPENROUTER_API_KEY, queryPriceUsdc: 0.01, payoutAddress: payout, demo: true });
      const res = NextResponse.json({ connected: true, demo: true, companyName: saved.session.companyName, total: Number(balance.totalEq), model: "ours" });
      res.headers.set("Set-Cookie", saved.cookie);
      return res;
    } catch (error) {
      return NextResponse.json({ error: (error instanceof Error ? error.message : "Demo hesabına bağlanılamadı").slice(0, 200) }, { status: 502 });
    }
  }
  if (body.action === "disconnect") {
    clearCompanySession(previousId);
    const res = NextResponse.json({ connected: false });
    res.headers.set("Set-Cookie", "aviax_company=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0");
    return res;
  }
  const previous = getCompanySession(previousId);
  const companyName = (body.companyName?.trim() || previous?.companyName || "").slice(0, 64);
  if (companyName.length < 2) return NextResponse.json({ error: "Şirket adını gir" }, { status: 400 });
  const submitted = [body.apiKey?.trim(), body.secretKey?.trim(), body.passphrase?.trim()];
  const okx = submitted.every((value) => !value) && previous ? previous.okx : { apiKey: submitted[0] ?? "", secretKey: submitted[1] ?? "", passphrase: submitted[2] ?? "" };
  if (Object.values(okx).some((v) => v.length < 4) || Object.values(okx).some((v) => v.length > 256)) return NextResponse.json({ error: "OKX demo API bilgilerini kontrol et" }, { status: 400 });
  const model: CompanySession["model"] = body.model === "openrouter" || body.model === "local" ? body.model : "ours";
  const price = Number(body.queryPriceUsdc ?? 0.01);
  if (!Number.isFinite(price) || price < 0.000001 || price > 100) return NextResponse.json({ error: "Sorgu bedeli 0.000001 ile 100 USDC arasında olmalı" }, { status: 400 });
  const payoutAddress = body.payoutAddress ?? previous?.payoutAddress;
  if (!payoutAddress || !isAddress(payoutAddress)) return NextResponse.json({ error: "Fuji cüzdanını bağla ve ödeme adresini doğrula" }, { status: 400 });
  const openrouterKey = body.openrouterKey?.trim() || previous?.openrouterKey;
  if (model === "openrouter" && (openrouterKey?.length ?? 0) < 12) return NextResponse.json({ error: "OpenRouter API anahtarını gir" }, { status: 400 });
  if (model === "openrouter" && body.modelSpec && !/^openrouter:[a-zA-Z0-9._/-]+(?::free)?$/.test(body.modelSpec)) return NextResponse.json({ error: "Geçersiz OpenRouter modeli" }, { status: 400 });
  if (model === "local" && (!body.modelSpec || !/^ollama:[a-zA-Z0-9._:-]+$/.test(body.modelSpec))) return NextResponse.json({ error: "Kurulu yerel ana model seç" }, { status: 400 });
  if (model === "local" && body.secondModelSpec && !/^ollama:[a-zA-Z0-9._:-]+$/.test(body.secondModelSpec)) return NextResponse.json({ error: "İkinci yerel model seçimi geçersiz" }, { status: 400 });
  try {
    const balance = await getBalance(okx);
    if (!balance || !Array.isArray(balance.details)) throw new Error("empty response");
    clearCompanySession(previousId);
    const saved = saveCompanySession({ companyName, okx, model, modelSpec: body.modelSpec, secondModelSpec: body.secondModelSpec, openrouterKey, queryPriceUsdc: price, payoutAddress: payoutAddress as `0x${string}`, riskPolicy: previous?.riskPolicy, companyAgentId: previous?.companyAgentId });
    const res = NextResponse.json({ connected: true, companyName, total: Number(balance.totalEq), assets: balance.details.filter((a) => Number(a.eq) > 0).length, model, modelSpec: body.modelSpec, secondModelSpec: body.secondModelSpec, queryPriceUsdc: price, payoutAddress, riskPolicy: saved.session.riskPolicy, companyAgentId: saved.session.companyAgentId, endpoint: `/api/company/decision/${saved.session.publicId}` });
    res.headers.set("Set-Cookie", saved.cookie);
    return res;
  } catch (error) {
    const text = error instanceof Error ? error.message : "OKX demo hesabına bağlanamadı";
    return NextResponse.json({ error: text.slice(0, 220) }, { status: 400 });
  }
}
