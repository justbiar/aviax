"use client";

import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { HistoryEntry, ModelScore } from "@/lib/decisionHistory";

/**
 * Vote history: what each model voted every round, the joint decision, the rule check and
 * how the portfolio moved afterwards, plus a scoreboard to decide which model to trust.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const TEAL = "rgb(64,214,196)";
const V: Record<string, { t: string; c: string }> = {
  yes: { t: "MÜDAHALE", c: "rgb(255,199,0)" },
  no: { t: "KORU", c: TEAL },
  uncertain: { t: "KARARSIZ", c: "rgba(255,255,255,0.55)" },
};
const A: Record<string, string> = { hold: "koru", rebalance: "dengele", derisk: "azalt", exit: "çık" };
const SEAT: Record<string, { t: string; c: string }> = { primary: { t: "ana", c: "rgb(255,199,0)" }, second: { t: "2. görüş", c: TEAL }, advisor: { t: "danışman", c: "rgb(196,181,253)" } };
const pct = (v: number) => `%${Math.round(v * 100)}`;
const usd = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);
const time = (ts: number) => new Date(ts).toLocaleTimeString("tr-TR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });

type Data = { entries: HistoryEntry[]; scores: ModelScore[]; total: number };

export function VoteHistory({ refreshKey }: { refreshKey: number | null }) {
  const [data, setData] = useState<Data | null>(null);
  const [open, setOpen] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/risk/history", { cache: "no-store" })
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [refreshKey]);

  const entries = data?.entries ?? [];
  const strip = [...entries].reverse();

  return (
    <section className="stage border-t border-white/10 bg-stage text-white">
      <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-sun">Oylama geçmişi · {data?.total ?? 0} tur</p>
            <h2 className="mt-1 font-display text-3xl tracking-wide sm:text-4xl">NE OLDU, KİM NE DEDİ?</h2>
            <p className="mt-1 max-w-[720px] text-sm text-white/55">Her turda her modelin oyu, ortak karar, kural kontrolü ve sonraki turdaki portföy değeri. Karnede hangi modelin kurala ve ortak karara ne kadar uyduğunu görüp ajanlarını buna göre konumlandır.</p>
          </div>
        </div>

        {/* verdict strip: one square per round, oldest left */}
        <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
          <div className="mb-2 flex items-center justify-between font-mono text-[10px] text-white/45">
            <span>eski</span>
            <span className="flex gap-3">{Object.entries(V).map(([k, v]) => <span key={k} style={{ color: v.c }}>■ {v.t.toLowerCase()}</span>)}</span>
            <span>yeni</span>
          </div>
          <div className="flex flex-wrap gap-1">
            {strip.length === 0 && <span className="font-mono text-xs text-white/40">henüz tur yok · ilk tur bitince burada başlar</span>}
            {strip.map((e) => (
              <button key={e.id} onClick={() => setOpen(open === e.id ? null : e.id)} title={`${time(e.ts)} · ${V[e.verdict]?.t} ${pct(e.verdictConfidence)}`} className="h-6 w-4 rounded-[3px] transition-transform hover:scale-125" style={{ background: V[e.verdict]?.c, opacity: 0.35 + e.verdictConfidence * 0.65, outline: open === e.id ? "2px solid white" : undefined }} aria-label={`Tur ${time(e.ts)}`} />
            ))}
          </div>
        </div>

        {/* scoreboard */}
        {data && data.scores.length > 0 && (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {data.scores.map((m, i) => (
              <motion.div key={`${m.seat}:${m.modelId}`} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: EASE, delay: i * 0.04 }} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-display text-lg tracking-wide" title={m.modelId}>{m.modelId}</span>
                  <span className="shrink-0 font-mono text-[10px]" style={{ color: SEAT[m.seat].c }}>{SEAT[m.seat].t}</span>
                </div>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5 font-mono text-[11px]">
                  <dt className="text-white/45">oy</dt><dd className="text-right">{m.votes}</dd>
                  <dt className="text-white/45">ortak kararla</dt><dd className="text-right">{pct(m.withDecision)}</dd>
                  <dt className="text-white/45">kural doğruluğu</dt><dd className="text-right">{m.ruleAccuracy === null ? "sorulmadı" : pct(m.ruleAccuracy)}</dd>
                  <dt className="text-white/45">ort. güven</dt><dd className="text-right">{pct(m.avgConfidence)}</dd>
                  <dt className="text-white/45">ort. gecikme</dt><dd className="text-right">{Math.round(m.avgLatencyMs)}ms</dd>
                  <dt className="text-white/45">son oy</dt><dd className="text-right" style={{ color: V[m.lastVote]?.c }}>{V[m.lastVote]?.t ?? m.lastVote}</dd>
                </dl>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/[0.06]" title="ortak kararla uyum">
                  <motion.div className="h-full rounded-full" style={{ background: SEAT[m.seat].c }} initial={{ width: 0 }} animate={{ width: pct(m.withDecision).slice(1) + "%" }} transition={{ duration: 0.8, ease: EASE }} />
                </div>
              </motion.div>
            ))}
          </div>
        )}

        {/* rounds */}
        {entries.length > 0 && (
          <div className="overflow-hidden rounded-card border border-white/10">
            <div className="hidden grid-cols-[90px_130px_110px_110px_minmax(0,1fr)_120px_150px] gap-3 border-b border-white/10 bg-white/[0.03] px-4 py-2 font-mono text-[10px] uppercase tracking-widest text-white/40 lg:grid">
              <span>saat</span><span>ortak karar</span><span>risk</span><span>aksiyon</span><span>oylar</span><span>sonraki tur</span><span>sonuç</span>
            </div>
            <div className="max-h-[520px] divide-y divide-white/5 overflow-y-auto scroll-thin">
              {entries.map((e, i) => {
                const next = entries[i - 1];
                const delta = next && e.total ? (next.total / e.total - 1) * 100 : null;
                const isOpen = open === e.id;
                return (
                  <div key={e.id} className={isOpen ? "bg-white/[0.04]" : ""}>
                    <button onClick={() => setOpen(isOpen ? null : e.id)} className="grid w-full grid-cols-2 items-center gap-3 px-4 py-2.5 text-left font-mono text-[11px] hover:bg-white/[0.03] lg:grid-cols-[90px_130px_110px_110px_minmax(0,1fr)_120px_150px]">
                      <span className="text-white/55">{time(e.ts)}</span>
                      <span className="font-bold" style={{ color: V[e.verdict]?.c }}>{V[e.verdict]?.t} {pct(e.verdictConfidence)}</span>
                      <span className={e.riskLevel === "critical" ? "text-[rgb(255,80,80)]" : e.riskLevel === "elevated" ? "text-orange-300" : "text-[rgb(0,200,120)]"}>{e.riskLevel}</span>
                      <span>{A[e.action] ?? e.action}{e.orders ? ` · ${usd(e.sellUsd)}` : ""}</span>
                      <span className="col-span-2 flex flex-wrap gap-1.5 lg:col-span-1">
                        {e.votes.map((v) => (
                          <span key={v.seat + v.modelId} className="rounded px-1.5 py-0.5" style={{ background: "rgba(255,255,255,0.06)", color: V[v.verdict]?.c }} title={`${v.modelId} (${SEAT[v.seat].t})`}>
                            <span style={{ color: SEAT[v.seat].c }}>●</span> {V[v.verdict]?.t.toLowerCase() ?? v.verdict} {pct(v.verdictP)}
                          </span>
                        ))}
                      </span>
                      <span className={delta === null ? "text-white/35" : delta >= 0 ? "text-[rgb(0,200,120)]" : "text-[rgb(255,80,80)]"}>{delta === null ? "son tur" : `${delta >= 0 ? "+" : ""}${delta.toFixed(3)}%`}</span>
                      <span className={e.execution === "executed" ? "font-bold text-[rgb(0,200,120)]" : e.approval ? "text-orange-300" : "text-white/45"}>
                        {e.execution === "executed" ? `uygulandı · ${usd(e.executedUsd)}` : e.approval ? "insan onayı" : e.execution === "cooldown" ? "yansıma bekleniyor" : e.orders ? "öneri" : "emir yok"}
                        {e.anchorTx && (
                          <a href={`https://testnet.snowtrace.io/tx/${e.anchorTx}`} target="_blank" rel="noreferrer" onClick={(ev) => ev.stopPropagation()} className="ml-1 text-sun underline-offset-2 hover:underline">
                            · Fuji ↗
                          </a>
                        )}
                      </span>
                    </button>
                    {isOpen && (
                      <div className="grid gap-3 px-4 pb-4 font-mono text-[11px] lg:grid-cols-[1fr_auto]">
                        <div className="space-y-1">
                          {e.votes.map((v) => (
                            <div key={v.seat + v.modelId} className="grid grid-cols-[90px_minmax(0,1fr)_auto] gap-3">
                              <span style={{ color: SEAT[v.seat].c }}>{SEAT[v.seat].t}</span>
                              <span className="truncate text-white/70">{v.modelId}</span>
                              <span className="text-white/60">{V[v.verdict]?.t ?? v.verdict} {pct(v.verdictP)}{v.action ? ` · ${A[v.action] ?? v.action}` : ""}{v.breachP !== null ? ` · ihlal ${pct(v.breachP)}` : ""} · {v.latencyMs}ms</span>
                            </div>
                          ))}
                        </div>
                        <div className="text-white/45 lg:text-right">
                          <div>portföy {usd(e.total)} · kural: {e.breaches.length ? `${e.breaches.length} ihlal (${e.breaches.join(", ")})` : "ihlal yok"}</div>
                          <div className="mt-1 break-all text-white/35">{e.hash}</div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
