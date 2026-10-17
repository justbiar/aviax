"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { RiskEvent } from "@/lib/riskDesk";
import type { LayerAnswer } from "@/lib/decisionLayer";
import { CandleChart } from "@/components/trade/CandleChart";
import { RiskField } from "./RiskField";

/**
 * Dark stage for the risk desk, built from the same visual language as the agent stage:
 * pipeline rail, mirrored primary/second-opinion distributions, verdict ring, live chart
 * and an event terminal. Everything shown comes from the risk desk event stream.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const TEAL = "rgb(64,214,196)";

const STEPS = [
  { key: "route", label: "Yönlendirme", who: "karar modeli" },
  { key: "portfolio", label: "OKX bakiye", who: "account" },
  { key: "market", label: "Piyasa", who: "ATK candles" },
  { key: "checks", label: "Limitler", who: "deterministik" },
  { key: "models", label: "Karar modelleri", who: "ana + 2. görüş" },
  { key: "decision", label: "Ortak karar", who: "ensemble" },
  { key: "approval", label: "Onay", who: "insan / politika" },
  { key: "hash", label: "Kayıt", who: "keccak256" },
] as const;

const Q: Record<string, { title: string; type: string }> = {
  verdict: { title: "Müdahale gerekli mi?", type: "choice" },
  risk_level: { title: "Risk seviyesi", type: "choice" },
  action: { title: "Risk aksiyonu", type: "choice" },
  cut: { title: "Stable'a aktarılacak pay", type: "choice" },
  breach: { title: "Limit ihlali var mı?", type: "noul (yes/no)" },
  dd_breach: { title: "Drawdown limiti aşıldı mı?", type: "noul (yes/no)" },
};
const NICE: Record<string, string> = {
  yes: "EVET", no: "HAYIR", uncertain: "KARARSIZ",
  low: "DÜŞÜK", elevated: "YÜKSELMİŞ", critical: "KRİTİK",
  hold: "KORU", rebalance: "DENGELE", derisk: "AZALT", exit: "ÇIK",
  none: "%0", small: "%10", half: "%50", all: "%100",
};
const nice = (k: string) => NICE[k] ?? k.toUpperCase();
const usd = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

type Find = <T extends RiskEvent["type"]>(t: T) => Extract<RiskEvent, { type: T }> | undefined;

export function RiskStage({ events, busy, lastScan, monitoring }: { events: RiskEvent[]; busy: boolean; lastScan: number | null; monitoring: boolean }) {
  const find: Find = (t) => [...events].reverse().find((e) => e.type === t) as never;
  const portfolio = find("portfolio");
  const checks = find("checks");
  const models = find("models");
  const decision = find("decision");
  const route = find("route");
  const seen = new Set(events.filter((e) => e.type === "stage").map((e) => (e as { stage: string }).stage));
  const chartAsset = portfolio?.holdings.find((h) => !h.reserve)?.ccy;
  const primary = models?.models.find((m) => m.seat === "primary");
  const second = models?.models.find((m) => m.seat === "second");
  const liveAdvisors = models?.reviewers.filter((r) => r.source === "live") ?? [];

  const done: Record<string, boolean> = {
    route: Boolean(route) || Boolean(portfolio),
    portfolio: Boolean(portfolio),
    market: Boolean(checks),
    checks: Boolean(checks),
    models: Boolean(models),
    decision: Boolean(decision),
    approval: Boolean(decision),
    hash: Boolean(decision),
  };
  const activeIdx = busy ? STEPS.findIndex((s) => !done[s.key]) : -1;
  const notes: Record<string, string> = {
    route: route ? `${route.desk} · ${route.ms}ms` : "risk masası",
    portfolio: portfolio ? usd(portfolio.total) : "",
    market: seen.has("market") || checks ? "60 günlük 1D" : "",
    checks: checks ? `${checks.checks.filter((c) => c.status === "breach").length} ihlal` : "",
    models: primary ? `${primary.latencyMs}ms${second ? ` · ${second.latencyMs}ms` : ""}` : "",
    decision: decision ? `${nice(decision.record.verdict)} %${Math.round(decision.record.verdictConfidence * 100)}` : "",
    approval: decision ? (decision.record.approval.required ? "insan onayı" : decision.record.orders.length ? "politika içinde" : "emir yok") : "",
    hash: decision ? decision.record.hash.slice(0, 10) : "",
  };

  return (
    <section id="stage" className="stage bg-stage text-white">
      <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-sun">Decision layer · risk masası · canlı</p>
            <h2 className="mt-1 font-display text-3xl tracking-wide sm:text-4xl">KARAR SAHNESİ</h2>
          </div>
          <span className="font-mono text-[11px] text-white/50">
            {busy ? "tur çalışıyor" : monitoring ? "10 sn'de bir yeniden değerlendirir" : "izleme duraklatıldı"}
            {lastScan ? ` · son tur ${new Date(lastScan).toLocaleTimeString("tr-TR")}` : ""}
          </span>
        </div>

        {/* pipeline */}
        <div className="rounded-card border border-white/10 bg-white/[0.02] px-4 py-5">
          <div className="relative">
            <div className="absolute left-0 right-0 top-[15px] h-px bg-white/10" aria-hidden />
            <motion.div className="absolute left-0 top-[15px] h-px bg-sun" animate={{ width: `${(STEPS.filter((s) => done[s.key]).length / (STEPS.length - 1)) * 100}%` }} transition={{ duration: 0.5, ease: EASE }} style={{ maxWidth: "100%" }} aria-hidden />
            <ol className="relative grid grid-cols-8 gap-1">
              {STEPS.map((st, i) => {
                const ok = done[st.key];
                const active = i === activeIdx;
                const fail = st.key === "approval" && decision?.record.approval.required;
                const dot = fail ? "bg-orange-400 border-orange-400 text-black" : ok ? "bg-sun border-sun text-black" : active ? "bg-black border-sun text-sun" : "bg-black border-white/20 text-white/40";
                return (
                  <li key={st.key} className="flex min-w-0 flex-col items-center text-center">
                    <span className={`relative grid h-[30px] w-[30px] place-items-center rounded-full border-2 font-mono text-[11px] font-bold transition-colors duration-300 ${dot}`}>
                      {fail ? "!" : ok ? "✓" : i + 1}
                      {active && <span className="absolute inset-0 animate-ping rounded-full border border-sun" />}
                    </span>
                    <span className={`mt-2 truncate text-[11px] font-bold sm:text-xs ${active ? "text-sun" : ok ? "text-white" : "text-white/40"}`}>{st.label}</span>
                    <span className="hidden truncate font-mono text-[9px] text-white/35 md:block">{notes[st.key] || st.who}</span>
                  </li>
                );
              })}
            </ol>
          </div>
        </div>

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_340px]">
          <div className="rounded-card border border-white/10 bg-black/40 p-2">
            <div className="flex items-center justify-between px-3 pt-2">
              <h3 className="font-display text-xl tracking-wide">{portfolio ? `${portfolio.label.split(" · ")[0]} · olasılık alanı` : "Olasılık alanı"}</h3>
              <span className="font-mono text-[10px] text-white/40">{primary ? `ana ${primary.modelId}${second ? ` · ikinci görüş ${second.modelId}` : ""}` : "hazır"}</span>
            </div>
            <div className="aspect-square w-full">
              <RiskField portfolio={portfolio} checks={checks} models={models} decision={decision} busy={busy} />
            </div>
          </div>

          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-xl tracking-wide">Varlıklar</h3>
              <span className="font-mono text-[10px] text-white/40">{portfolio ? `${usd(portfolio.total)} · OKX canlı` : "bakiye bekleniyor"}</span>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(portfolio?.holdings ?? []).slice(0, 6).map((h, i) => {
                const hot = !h.reserve && checks?.checks.some((c) => c.key === "weight" && c.status === "breach") && h.ccy === portfolio?.holdings.find((x) => !x.reserve)?.ccy;
                return (
                  <motion.div key={h.ccy} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: i * 0.04 }} className={`rounded-xl border p-3 ${hot ? "border-[rgb(255,80,80)]/50 bg-[rgb(255,80,80)]/[0.06]" : "border-white/10 bg-white/[0.03]"}`}>
                    <div className="flex items-center justify-between">
                      <span className="font-display text-lg tracking-wide">{h.ccy}</span>
                      <span className={`font-mono text-[10px] ${h.reserve ? "text-white/45" : hot ? "text-[rgb(255,120,120)]" : "text-sun"}`}>{h.reserve ? "rezerv" : hot ? "limit üstü" : "riskli"}</span>
                    </div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
                      <motion.div className="h-full rounded-full" style={{ background: h.reserve ? "rgba(255,255,255,0.4)" : hot ? "rgb(255,80,80)" : "rgb(255,199,0)" }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, h.weight)}%` }} transition={{ duration: 0.8, ease: EASE }} />
                    </div>
                    <div className="mt-1.5 flex justify-between font-mono text-[10px] text-white/55">
                      <span>%{h.weight.toFixed(1)}</span>
                      <span>{usd(h.usd)}</span>
                      <span className={h.chg7d === null ? "" : h.chg7d >= 0 ? "text-[rgb(0,200,120)]" : "text-[rgb(255,80,80)]"}>{h.chg7d === null ? "-" : `7g ${h.chg7d >= 0 ? "+" : ""}${h.chg7d.toFixed(1)}%`}</span>
                    </div>
                  </motion.div>
                );
              })}
              {!portfolio && Array.from({ length: 4 }, (_, i) => <div key={i} className="h-[74px] animate-pulse rounded-xl border border-white/10 bg-white/[0.02]" />)}
            </div>
            {models?.answers.verdict && <Dist k="verdict" a={models.answers.verdict} index={0} pMs={primary?.latencyMs} sMs={second?.latencyMs} />}
          </div>

          <div className="h-[520px] xl:h-auto">
            <Terminal events={events} />
          </div>
        </div>

        {/* limit gauges */}
        {checks && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            {checks.checks.map((c, i) => <Gauge key={c.key} c={c} index={i} />)}
            <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">1 günlük VaR 95</div>
              <div className="mt-1 font-display text-3xl text-white">%{checks.var95.toFixed(2)}</div>
              <div className="mt-1 font-mono text-[10px] text-white/45">tarihsel, bilgi amaçlı</div>
            </div>
          </div>
        )}

        {/* distributions */}
        <AnimatePresence>
          {models && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
              <div className="flex flex-wrap items-end justify-between gap-2">
                <h3 className="font-display text-xl tracking-wide">Karar dağılımları</h3>
                <span className="flex gap-4 font-mono text-[10px]">
                  <span className="text-sun">■ ana · {primary?.modelId}</span>
                  {second && <span style={{ color: TEAL }}>■ 2. görüş · {second.modelId}</span>}
                </span>
              </div>
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {Object.keys(Q).filter((k) => k !== "verdict" && models.answers[k]).map((k, i) => (
                  <Dist key={k} k={k} a={models.answers[k]} index={i} pMs={primary?.latencyMs} sMs={second?.latencyMs} />
                ))}
              </div>
              {liveAdvisors.length > 0 && (
                <div className="rounded-xl border border-violet-300/20 bg-violet-300/[0.05] p-4">
                  <div className="font-mono text-[10px] uppercase tracking-widest text-violet-300">OpenRouter danışmanları · ortak karara düşük ağırlıkla katılır</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    {liveAdvisors.map((r) => {
                      const v = Object.entries(r.answers.verdict ?? {}).sort((a, b) => b[1] - a[1])[0];
                      return (
                        <div key={r.modelId} className="flex items-center justify-between gap-2 font-mono text-[11px]">
                          <span className="truncate text-white/70">{r.modelId.replace("openrouter:", "").replace(":free", "")}</span>
                          <span className="text-violet-200">{v ? `${nice(v[0])} %${Math.round(v[1] * 100)}` : "-"} · {r.latencyMs}ms{r.cached ? " · önceki tur" : ""}</span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>

        {/* orders + approval */}
        {decision && (
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="grid gap-4 xl:grid-cols-2">
            <div className="space-y-4">
            <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
              <h3 className="mb-3 font-display text-xl tracking-wide">Önerilen emirler</h3>
              {decision.record.orders.length === 0 ? (
                <p className="font-mono text-xs text-white/50">Emir yok. Portföy politika içinde ve modeller müdahale önermiyor.</p>
              ) : (
                <div className="space-y-2">
                  {decision.record.orders.map((o) => (
                    <div key={o.instId} className="grid grid-cols-[70px_1fr_auto] items-center gap-3 rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-[11px]">
                      <span className="font-bold text-short">SAT {o.ccy}</span>
                      <span className="truncate text-white/55">{o.reason}</span>
                      <span className="text-right text-white">{usd(o.usd)}</span>
                    </div>
                  ))}
                  <div className="flex justify-between border-t border-white/10 pt-2 font-mono text-xs">
                    <span className="text-white/50">toplam stable'a aktarım</span>
                    <span className="text-sun">{usd(decision.record.sellUsd)}</span>
                  </div>
                </div>
              )}
              <p className="mt-3 font-mono text-[10px] text-white/35">Emir miktarlarını kod hesaplar (limitleri geri getiren minimum + modelin seçtiği ek azaltım). Karar motoru OKX'e otomatik emir göndermez.</p>
            </div>
            <div className={`rounded-card border p-4 ${decision.record.approval.required ? "border-orange-300/40 bg-orange-300/[0.06]" : "border-white/10 bg-white/[0.02]"}`}>
              <h3 className="font-display text-xl tracking-wide">{decision.record.approval.required ? "İnsan onayı gerekli" : decision.record.orders.length ? "Politika içinde" : "Onay gerekmiyor"}</h3>
              <ul className="mt-2 space-y-1 font-mono text-[11px] text-white/70">
                {decision.record.approval.reasons.length ? decision.record.approval.reasons.map((r) => <li key={r}>· {r}</li>) : <li>· model güveni ve uyumu eşiklerin üstünde</li>}
                <li>· model ↔ kural kontrolü: {decision.record.modelRuleMatch ? "uyumlu" : "çelişkili"}</li>
                <li>· model uyumu %{Math.round(decision.record.agreement * 100)} · güven %{Math.round(decision.record.confidence * 100)}</li>
              </ul>
              <div className="mt-3 border-t border-white/10 pt-2 font-mono text-[10px] text-white/45">
                kayıt #{decision.record.id} · <span className="text-white/70">{decision.record.hash}</span>
              </div>
            </div>
            </div>
            <div className="overflow-hidden rounded-card border border-white/10 bg-white/[0.02]">
              <div className="flex items-center justify-between px-4 pt-4">
                <h3 className="font-display text-xl tracking-wide">{chartAsset ? `${chartAsset}-USDT · canlı` : "Piyasa"}</h3>
                <span className="font-mono text-[10px] text-white/40">en büyük riskli varlık</span>
              </div>
              {chartAsset && <CandleChart instId={`${chartAsset}-USDT`} dark height={360} />}
            </div>
          </motion.div>
        )}
      </div>
    </section>
  );
}

function Dist({ k, a, index, pMs, sMs }: { k: string; a: LayerAnswer; index: number; pMs?: number; sMs?: number }) {
  const q = Q[k];
  return (
    <motion.div initial={{ opacity: 0, y: 14, filter: "blur(4px)" }} animate={{ opacity: 1, y: 0, filter: "blur(0px)" }} transition={{ duration: 0.5, ease: EASE, delay: index * 0.04 }} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">{q.type}</div>
          <div className="font-display text-lg tracking-wide text-white">{q.title}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl text-sun">{nice(a.pick)}</div>
          <div className="font-mono text-[10px] text-white/45">ensemble %{Math.round(a.confidence * 100)}</div>
        </div>
      </div>
      <div className="mt-3 space-y-1.5">
        {a.labels.map((l, i) => {
          const isPick = l === a.pick;
          return (
            <div key={l} className="grid grid-cols-[1fr_72px_1fr] items-center gap-2">
              <div className="flex h-3 justify-end overflow-hidden rounded-l-full bg-white/[0.04]">
                <motion.div className="h-full rounded-l-full bg-sun" style={{ opacity: isPick ? 1 : 0.45 }} initial={{ width: 0 }} animate={{ width: `${(a.primary[l] ?? 0) * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.05 }} />
              </div>
              <div className={`truncate text-center font-mono text-[10px] ${isPick ? "font-bold text-white" : "text-white/50"}`}>{nice(l)}</div>
              <div className="flex h-3 overflow-hidden rounded-r-full bg-white/[0.04]">
                {a.second && <motion.div className="h-full rounded-r-full" style={{ background: TEAL, opacity: isPick ? 1 : 0.45 }} initial={{ width: 0 }} animate={{ width: `${(a.second[l] ?? 0) * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: 0.15 + i * 0.05 }} />}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[10px]">
        <span className="text-sun">ana {pMs ?? "-"}ms</span>
        <span className="text-white/35">uyum %{Math.round(a.agreement * 100)} · 1 forward pass</span>
        <span style={{ color: TEAL }}>{a.second ? `2. görüş ${sMs ?? "-"}ms` : "tek model"}</span>
      </div>
    </motion.div>
  );
}

function Gauge({ c, index }: { c: Extract<RiskEvent, { type: "checks" }>["checks"][number]; index: number }) {
  const scale = Math.max(c.limit * 1.6, c.value * 1.1, 1);
  const tone = c.status === "breach" ? "rgb(255,80,80)" : c.status === "near" ? "rgb(253,186,116)" : "rgb(0,200,120)";
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: index * 0.05 }} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[10px] uppercase tracking-widest text-white/40">{c.label}</span>
        <span className="font-mono text-[10px] font-bold" style={{ color: tone }}>{c.status === "breach" ? "İHLAL" : c.status === "near" ? "YAKIN" : "OK"}</span>
      </div>
      <div className="mt-1 font-display text-3xl text-white">%{c.value.toFixed(1)}</div>
      <div className="relative mt-2 h-2 rounded-full bg-white/[0.06]">
        <motion.div className="h-2 rounded-full" style={{ background: tone }} initial={{ width: 0 }} animate={{ width: `${Math.min(100, (c.value / scale) * 100)}%` }} transition={{ duration: 0.8, ease: EASE }} />
        <span className="absolute -top-1 h-4 w-px bg-white" style={{ left: `${(c.limit / scale) * 100}%` }} aria-hidden />
      </div>
      <div className="mt-1 font-mono text-[10px] text-white/45">{c.dir === "max" ? "üst limit" : "alt limit"} %{c.limit}</div>
    </motion.div>
  );
}

function Terminal({ events }: { events: RiskEvent[] }) {
  const box = useRef<HTMLDivElement>(null);
  const lines: { t: string; tone: string; tool?: string }[] = [];
  for (const e of events) {
    if (e.type === "stage") lines.push({ t: e.text, tone: "text-white/70" });
    if (e.type === "route") lines.push({ t: `talep → ${e.desk} masası (%${Math.round(e.answer.confidence * 100)})`, tone: "text-sun", tool: "route" });
    if (e.type === "portfolio") lines.push({ t: `${e.holdings.length} varlık · ${usd(e.total)}`, tone: "text-white/70", tool: "account_balance" });
    if (e.type === "checks") for (const c of e.checks) lines.push({ t: `${c.label}: %${c.value.toFixed(1)} (limit %${c.limit})`, tone: c.status === "breach" ? "text-[rgb(255,80,80)]" : c.status === "near" ? "text-orange-300" : "text-[rgb(0,200,120)]", tool: "check" });
    if (e.type === "models") {
      for (const m of e.models) lines.push({ t: `${m.modelId} · ${m.latencyMs}ms · ${m.source}`, tone: m.seat === "primary" ? "text-sun" : "text-[rgb(64,214,196)]", tool: m.seat === "primary" ? "ana" : "2. görüş" });
      for (const r of e.reviewers.filter((x) => x.source === "live")) lines.push({ t: `${r.modelId} · ${r.latencyMs}ms`, tone: "text-violet-300", tool: "danışman" });
    }
    if (e.type === "decision") {
      const r = e.record;
      lines.push({ t: `karar ${nice(r.verdict)} · risk ${nice(r.riskLevel)} · aksiyon ${nice(r.action)} · ${r.orders.length} emir`, tone: "text-sun", tool: "decision" });
      lines.push({ t: r.approval.required ? `insan onayı: ${r.approval.reasons.join("; ")}` : "otomatik onay eşiği içinde", tone: r.approval.required ? "text-orange-300" : "text-[rgb(0,200,120)]", tool: "approval" });
      lines.push({ t: r.hash, tone: "text-white/50", tool: "hash" });
    }
    if (e.type === "error") lines.push({ t: e.text, tone: "text-[rgb(255,80,80)]", tool: "hata" });
  }
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [lines.length]);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[11px] text-white/50">aviax-risk-desk / events</span>
      </div>
      <div ref={box} className="flex-1 space-y-1.5 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed scroll-thin" aria-live="polite">
        {lines.length === 0 && <p className="text-white/35">$ ilk tur bekleniyor</p>}
        {lines.map((l, i) => (
          <div key={i} className={l.tone}>
            {l.tool && <span className="mr-1 rounded bg-white/10 px-1 text-white/80">{l.tool}</span>}
            {l.t}
          </div>
        ))}
      </div>
    </div>
  );
}
