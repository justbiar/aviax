"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import type { Policy, RiskEvent, Source, Shock } from "@/lib/riskDesk";
import { CandleChart } from "@/components/trade/CandleChart";
import { RiskStage } from "@/components/decision/RiskStage";
import { startDemo } from "@/components/DemoGate";

const EASE = [0.22, 1, 0.36, 1] as const;
const dollars = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const labels: Record<string, string> = { verdict: "Müdahale kararı", risk_level: "Risk seviyesi", action: "Aksiyon", cut: "Risk azaltımı" };
const chartColors = ["#FFC700", "#141414", "#79B8FF", "#FF8066", "#63C7A5", "#B799FF", "#F39AC7", "#9AA3AF"];
const DEFAULT_COMPANY_POLICY: Policy = { maxWeight: 40, maxDrawdown: 15, minReserve: 20, maxVol: 60, approvalUsd: 10_000 };

export default function DecisionPage() {
  const [companyName, setCompanyName] = useState("Aviax Yapım İşleri LTD ŞTİ");
  const [policy, setPolicy] = useState<Policy>(DEFAULT_COMPANY_POLICY);
  const [monitoring, setMonitoring] = useState(true);
  const [reviewers, setReviewers] = useState<string[]>([]);
  const [reviewersReady, setReviewersReady] = useState(false);
  const [accountReady, setAccountReady] = useState(false);
  const [companyConnected, setCompanyConnected] = useState(false);
  const [companyModel, setCompanyModel] = useState<"ours" | "local" | "openrouter">("ours");
  const [busy, setBusy] = useState(false);
  const [lastScan, setLastScan] = useState<number | null>(null);
  const [events, setEvents] = useState<RiskEvent[]>([]);
  const [error, setError] = useState("");
  const runLock = useRef(false);
  useEffect(() => {
    fetch("/api/models", { cache: "no-store" }).then((r) => r.json()).then((d: { options?: { value: string }[] }) => {
      const free = (d.options ?? []).map((o) => o.value).filter((v) => v.startsWith("openrouter:") && v !== "openrouter:openrouter/free" && v.endsWith(":free"));
      const preferred = ["openrouter:liquid/lfm-2.5-2.6b:free", "openrouter:poolside/laguna-xs-2.1:free", "openrouter:cohere/north-mini-code:free"];
      setReviewers([...preferred.filter((v) => free.includes(v)), ...free.filter((v) => !preferred.includes(v))].slice(0, 2));
    }).catch(() => setReviewers([])).finally(() => setReviewersReady(true));
  }, []);
  useEffect(() => {
    fetch("/api/company/connect", { cache: "no-store" }).then((r) => r.json()).then((d: { connected?: boolean; companyName?: string; model?: "ours" | "local" | "openrouter"; riskPolicy?: Policy }) => { setCompanyConnected(Boolean(d.connected)); if (d.companyName) setCompanyName(d.companyName); if (d.model) setCompanyModel(d.model); if (d.riskPolicy) setPolicy({ ...DEFAULT_COMPANY_POLICY, ...d.riskPolicy }); }).catch(() => setCompanyConnected(false)).finally(() => setAccountReady(true));
  }, []);
  const run = useCallback(async () => {
    if (runLock.current) return;
    runLock.current = true;
    let skipped = false;
    setBusy(true); setError("");
    try {
      const res = await fetch("/api/risk", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ source: "okx" satisfies Source, shock: "none" satisfies Shock, policy, companyName, reviewers }) });
      // Too-soon or busy turns are skipped quietly; the next 10 s tick runs again.
      if (res.status === 429) { skipped = true; return; }
      if (!res.ok || !res.body) throw new Error((await res.json()).error ?? "İstek başarısız");
      const reader = res.body.getReader(), decoder = new TextDecoder(); let buffer = "";
      while (true) {
        const { value, done } = await reader.read(); buffer += decoder.decode(value, { stream: !done });
        const lines = buffer.split("\n"); buffer = lines.pop() ?? "";
        for (const line of lines) if (line.trim()) { const ev = JSON.parse(line) as RiskEvent; setEvents((old) => ev.type === "portfolio" ? [ev] : ev.type === "stage" ? [...old.filter((item) => item.type !== "stage"), ev] : [...old, ev]); if (ev.type === "error") setError(ev.text); }
        if (done) break;
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Risk analizi başarısız"); }
    finally { setBusy(false); runLock.current = false; if (!skipped) setLastScan(Date.now()); }
  }, [companyName, policy, reviewers]);
  const runRef = useRef(run);
  useEffect(() => { runRef.current = run; }, [run]);
  useEffect(() => {
    if (!monitoring || !reviewersReady || !accountReady || !companyConnected) return;
    void runRef.current();
    const timer = window.setInterval(() => void runRef.current(), 10_000);
    return () => window.clearInterval(timer);
  }, [monitoring, reviewersReady, accountReady, companyConnected]);
  const portfolio = [...events].reverse().find((e) => e.type === "portfolio");
  const checks = [...events].reverse().find((e) => e.type === "checks");
  const models = [...events].reverse().find((e) => e.type === "models");
  const decision = [...events].reverse().find((e) => e.type === "decision");
  const chartAsset = portfolio?.type === "portfolio" ? portfolio.holdings.find((h) => !h.reserve)?.ccy : undefined;
  const stages = events.filter((e) => e.type === "stage");
  const input = "mt-1 w-full rounded-btn border border-ink/15 bg-white px-3 py-2.5 font-mono text-sm";
  const historical = checks?.type === "checks" && portfolio?.type === "portfolio"
    ? checks.series.map((v) => portfolio.total * v / (checks.series.at(-1) || 1))
    : [];
  const pie = portfolio?.type === "portfolio" ? `conic-gradient(${portfolio.holdings.map((h, i, arr) => {
    const start = arr.slice(0, i).reduce((sum, item) => sum + item.weight, 0) * 3.6;
    return `${chartColors[i % chartColors.length]} ${start}deg ${start + h.weight * 3.6}deg`;
  }).join(", ")})` : undefined;
  if (accountReady && !companyConnected) return <main className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6"><div className="mx-auto max-w-5xl rounded-card border-2 border-ink bg-white p-7 shadow-brut sm:p-10"><p className="font-mono text-xs uppercase tracking-[.18em] text-ink/50">OKX AI · ŞİRKET HAZİNESİ</p><h1 className="mt-3 font-display text-5xl">KENDİ ŞİRKET HESABINI BAĞLA</h1><p className="mt-4 max-w-2xl text-ink/65">Canlı analiz senin OKX demo portföyünü kullanır. Aviax demo hesabı ortak kullanılmaz. Şirket kurulumunu, Fuji cüzdanını ve karar motorunu hazırlamak için önce onboarding'i tamamla.</p><div className="mt-6 flex flex-wrap gap-3"><button onClick={() => { void startDemo().then(() => window.location.reload()).catch((e: Error) => setError(e.message)); }} className="inline-flex rounded-btn border-2 border-ink bg-sun px-5 py-3 font-bold shadow-btn">Demoya geç →</button><Link href="/company" className="inline-flex rounded-btn border-2 border-ink bg-paper px-5 py-3 font-bold">Kendi şirketini bağla →</Link></div>{error && <p className="mt-3 text-sm text-short">{error}</p>}</div><DecisionPreview /></main>;
  const primaryModel = models?.type === "models" ? models.models.find((m) => m.seat === "primary") : undefined;
  return <main>
    {/* HERO */}
    <section className="paper-grid border-b border-ink/10">
      <div className="mx-auto max-w-[1100px] px-4 pb-12 pt-12 text-center sm:pt-16">
        <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-bold shadow-btn">
          <span className="h-2 w-2 rounded-full bg-sun" /> Decision layer · OKX AI · risk masası
        </motion.span>
        <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.08 }} className="mt-5 font-display text-[44px] uppercase leading-[0.95] tracking-tight sm:text-7xl">
          Portföyü LLM yorumlamaz.
          <br />
          <span className="relative inline-block">
            <span className="relative z-10">Karar modelleri ölçer.</span>
            <motion.span className="absolute inset-x-[-6px] bottom-1 z-0 h-[38%] origin-left bg-sun" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }} />
          </span>
        </motion.h1>
        <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.25 }} className="mx-auto mt-5 max-w-[680px] text-lg font-medium text-ink/75 sm:text-xl">
          {companyName} OKX bakiyesi 10 saniyede bir okunur. Limitleri kod ölçer, müdahale kararını iki karar modeli olasılık dağılımı olarak verir. Büyük kararlar insan onayına düşer.
        </motion.p>

        <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.35 }} className="mx-auto mt-8 max-w-[860px] rounded-card border border-ink/15 bg-paper p-5 text-left shadow-card sm:p-6">
          <div className="grid gap-4 sm:grid-cols-[1fr_auto] sm:items-end">
            <label className="text-xs font-bold uppercase tracking-wider text-ink/55">Şirket / kurum<input value={companyName} maxLength={64} onChange={(e) => setCompanyName(e.target.value)} className={input} placeholder="Örn. Aviax Yapım İşleri LTD ŞTİ" /></label>
            <div className="flex flex-wrap items-center gap-2">
              <button onClick={() => setMonitoring((x) => !x)} className={`min-h-[40px] rounded-btn border px-3 text-xs font-bold ${monitoring ? "border-long/40 bg-long/10 text-long" : "border-ink/20 text-ink/60"}`}>● {monitoring ? "İZLEME AÇIK · DURAKLAT" : "İZLEMEYİ BAŞLAT"}</button>
              <button onClick={() => void run()} disabled={busy} className="min-h-[40px] rounded-btn border-2 border-ink bg-sun px-4 text-sm font-bold shadow-btn disabled:opacity-50">{busy ? "Tur çalışıyor…" : "Şimdi değerlendir"}</button>
            </div>
          </div>
          <div className="mt-4 text-xs font-bold uppercase tracking-wider text-ink/55">Risk politikası (yetki)</div>
          <div className="mt-2 grid gap-3 sm:grid-cols-3 lg:grid-cols-5">{([["maxWeight", "Varlık üst sınırı %"], ["maxDrawdown", "Maks. düşüş %"], ["minReserve", "Min. rezerv %"], ["maxVol", "Maks. oynaklık %"], ["approvalUsd", "İnsan onay eşiği $"]] as [keyof Policy, string][]).map(([key, title]) => <label key={key} className="text-[11px] font-semibold text-ink/60">{title}<input type="number" min={0} value={policy[key]} onChange={(e) => setPolicy((p) => ({ ...p, [key]: Number(e.target.value) }))} className={input} /></label>)}</div>
          {error && <p className="mt-4 rounded-btn border border-short/30 bg-short/5 p-3 text-sm text-short">{error}</p>}
        </motion.div>
        <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-muted">
          <span>model <b className="text-ink">{companyModel === "ours" ? "Aviax karar modelleri" : companyModel === "local" ? "yerel Ollama" : "OpenRouter"}</b></span>
          <span>ana model gecikme <b className="text-ink">{primaryModel ? `${primaryModel.latencyMs}ms` : "-"}</b></span>
          <span>son tur <b className="text-ink">{lastScan ? new Date(lastScan).toLocaleTimeString("tr-TR") : "-"}</b></span>
          <span>son karar <b className="text-ink">{decision?.type === "decision" ? (decision.record.verdict === "yes" ? "MÜDAHALE" : decision.record.verdict === "no" ? "KORU" : "KARARSIZ") : "-"}</b></span>
          <span>{stages.at(-1)?.type === "stage" && busy ? (stages.at(-1) as { text: string }).text : ""}</span>
        </div>
      </div>
    </section>

    <RiskStage events={events} busy={busy} lastScan={lastScan} monitoring={monitoring} />

    {/* INTEGRATION */}
    <section className="border-t border-ink/10 bg-paper">
      <div className="mx-auto grid max-w-[1440px] gap-4 px-4 py-10 sm:px-6 lg:grid-cols-[1fr_380px]">
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
          {[["01", "Şirket verisi", "OKX bakiyesi ve ATK piyasa geçmişi sunucuda toplanır."], ["02", "Limitler", "Yoğunlaşma, rezerv, drawdown, oynaklık kodla ölçülür."], ["03", "Karar modelleri", "Ana model + ikinci görüş, her soru tek forward pass."], ["04", "İnsan onayı", "Büyük, belirsiz veya çelişkili karar onaya düşer."], ["05", "Kayıt", "Her karar keccak256 hash ile izlenebilir."]].map(([n, h, t]) => <article key={n} className="rounded-card border border-ink/15 bg-paper p-4 shadow-card"><span className="font-mono text-xs text-muted">{n}</span><h3 className="mt-2 font-display text-xl uppercase">{h}</h3><p className="mt-1 text-sm text-ink/65">{t}</p></article>)}
        </div>
        <div className="rounded-card border-2 border-ink bg-ink p-5 text-paper shadow-brut">
          <div className="font-mono text-[10px] uppercase tracking-widest text-sun">Ajan entegrasyonu · MCP / HTTP</div>
          <code className="mt-3 block font-mono text-xs leading-relaxed text-white/85">POST /api/decision<br />{"{ state, questions }"}<br /><br />mcp: aviax_decide</code>
          <p className="mt-3 text-xs text-white/55">Aynı karar katmanını trade ajanı, risk masası ve OKX AI ajanları kullanır.</p>
        </div>
      </div>
    </section>
  </main>;
}

function PortfolioLine({ values }: { values: number[] }) {
  const width = 1000, height = 210, pad = 12;
  const min = Math.min(...values), max = Math.max(...values);
  const spread = max - min || Math.max(1, max * 0.01);
  const points = values.map((value, i) => `${pad + (i / Math.max(1, values.length - 1)) * (width - pad * 2)},${height - pad - ((value - min) / spread) * (height - pad * 2)}`);
  const first = points[0]?.split(",")[0] ?? String(pad);
  const last = points.at(-1)?.split(",")[0] ?? String(width - pad);
  const line = points.join(" ");
  const area = `${first},${height - pad} ${line} ${last},${height - pad}`;
  return <svg className="h-full w-full overflow-visible" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" role="img" aria-label="Son 30 günlük yaklaşık şirket portföyü performans çizgisi">
    <defs><linearGradient id="portfolio-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#FFC700" stopOpacity="0.35" /><stop offset="100%" stopColor="#FFC700" stopOpacity="0.02" /></linearGradient></defs>
    {[0.25, 0.5, 0.75].map((v) => <line key={v} x1={pad} x2={width - pad} y1={pad + v * (height - pad * 2)} y2={pad + v * (height - pad * 2)} stroke="#141414" strokeOpacity="0.08" strokeDasharray="4 6" />)}
    <polygon points={area} fill="url(#portfolio-fill)" />
    <polyline points={line} fill="none" stroke="#141414" strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
  </svg>;
}

function DecisionPreview() {
  return <section className="stage mx-auto mt-7 max-w-5xl rounded-card border border-ink/10 bg-stage p-5 text-white sm:p-7"><div className="mb-5"><p className="font-mono text-[10px] uppercase tracking-[.18em] text-sun">OKX AI · Şirket karar paneli</p><h2 className="mt-1 font-display text-3xl">KARAR GÖRSELLEŞTİRMESİ</h2><p className="mt-2 text-sm text-white/50">Bağlantı önizlemesi · Şirket hesabını bağlayınca bu alanda canlı portföy, model dağılımları ve Trade mum grafiği gösterilecek.</p></div><div className="grid gap-5 xl:grid-cols-[320px_minmax(0,1fr)]"><div className="grid min-h-[320px] place-items-center rounded-card border border-white/10 bg-black/35 p-5"><div className="grid h-56 w-56 place-items-center rounded-full border-[16px] border-dashed border-white/15"><div className="text-center"><span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Karar durumu</span><b className="mt-1 block font-display text-3xl text-white/60">BEKLEMEDE</b><span className="mt-1 block text-xs text-white/40">OKX hesabı bekleniyor</span></div></div></div><div className="grid min-h-[320px] place-items-center rounded-card border border-white/10 bg-black/35 p-5"><div className="w-full rounded-btn border border-dashed border-white/15 p-5"><div className="flex items-center justify-between"><span className="font-mono text-[10px] uppercase tracking-widest text-white/40">Şirket portföyüne ait piyasa grafiği</span><span className="font-mono text-[10px] text-white/35">OKX · LIVE</span></div><div className="mt-5 grid h-48 place-items-center rounded bg-[linear-gradient(to_right,rgba(255,255,255,.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,.05)_1px,transparent_1px)] bg-[size:32px_32px] font-mono text-xs text-white/35">Portföy bağlanınca grafik yüklenir</div></div></div></div><div className="mt-5 grid gap-4 sm:grid-cols-2"><div className="rounded-card border border-white/10 bg-black/30 p-4"><h3 className="font-display text-lg">YEREL KARAR MODELİ</h3><p className="mt-2 font-mono text-xs text-white/40">Evet · Hayır · Kararsız dağılımı bekleniyor</p><div className="mt-4 flex gap-1">{["EVET", "HAYIR", "KARARSIZ"].map((v) => <span key={v} className="flex-1 rounded bg-white/5 py-3 text-center font-mono text-[10px] text-white/40">{v}<br />--</span>)}</div></div><div className="rounded-card border border-white/10 bg-black/30 p-4"><h3 className="font-display text-lg">DİĞER MODEL ÖNERİLERİ</h3><p className="mt-2 font-mono text-xs text-white/40">Şirket hesabı bağlandıktan sonra gösterilir</p><div className="mt-4 flex h-[58px] items-center justify-center rounded border border-dashed border-white/10 font-mono text-[10px] text-white/30">Öneri bekleniyor</div></div></div></section>;
}

function VerdictOrbit({ verdict, probabilities, total }: { verdict: "yes" | "no" | "uncertain" | null; probabilities?: Record<"yes" | "no" | "uncertain", number>; total: number | null }) {
  const p = probabilities ?? { yes: 0, no: 0, uncertain: 0 };
  const names = { yes: "EVET", no: "HAYIR", uncertain: "KARARSIZ" } as const;
  const color = verdict === "yes" ? "#FFC700" : verdict === "no" ? "#FF665C" : "#A7B0BE";
  const stops = [
    `#FFC700 0% ${p.yes * 100}%`,
    `#FF665C ${p.yes * 100}% ${(p.yes + p.no) * 100}%`,
    `#A7B0BE ${(p.yes + p.no) * 100}% 100%`,
  ].join(", ");
  return <div className="flex flex-col items-center py-2 text-center"><p className="font-mono text-[10px] uppercase tracking-[.2em] text-white/45">Kurumsal karar · ensemble</p><div className="relative mt-4 h-56 w-56 rounded-full p-3" style={{ background: probabilities ? `conic-gradient(${stops})` : "conic-gradient(#555 0deg 360deg)" }}><div className="flex h-full w-full flex-col items-center justify-center rounded-full border border-white/10 bg-[#111] px-4"><span className="font-mono text-[10px] uppercase tracking-widest text-white/45">Müdahale?</span><b className="mt-1 font-display text-3xl" style={{ color }}>{verdict ? names[verdict] : "BEKLE"}</b><span className="mt-1 font-mono text-xs text-white/60">{verdict ? `${Math.round((probabilities?.[verdict] ?? 0) * 100)}% güven` : total === null ? "şirket verisi bekleniyor" : "modeller yanıtlıyor"}</span></div></div><div className="mt-4 grid w-full grid-cols-3 gap-2 text-[10px]"><div className="rounded bg-white/5 p-2"><b className="block text-sun">EVET</b>{probabilities ? `${Math.round(p.yes * 100)}%` : "--"}</div><div className="rounded bg-white/5 p-2"><b className="block text-red-300">HAYIR</b>{probabilities ? `${Math.round(p.no * 100)}%` : "--"}</div><div className="rounded bg-white/5 p-2"><b className="block text-white/65">KARARSIZ</b>{probabilities ? `${Math.round(p.uncertain * 100)}%` : "--"}</div></div><div className="mt-4 border-t border-white/10 pt-3"><p className="font-mono text-[10px] uppercase tracking-widest text-white/40">OKX şirket portföyü</p><p className="mt-1 font-display text-2xl text-white">{total === null ? "--" : dollars(total)}</p></div></div>;
}
