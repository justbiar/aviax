"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect } from "react";
import { usePoll } from "@/lib/usePoll";
import type { FleetAgentView } from "@/components/agent/Fleet";
import { useAgent } from "@/components/agent/useAgent";
import { DecisionField } from "@/components/agent/DecisionField";
import { PipelineRail } from "@/components/agent/PipelineRail";
import { Ledger } from "@/components/agent/Ledger";
import { DistributionCard } from "@/components/agent/DistributionCard";

const EASE = [0.22, 1, 0.36, 1] as const;

export default function Home() {
  const { s, follow, followId } = useAgent();
  const { data: fleet } = usePoll<FleetAgentView[]>("/api/fleet", 5000);
  const agents = (fleet ?? []).filter((a) => !a.decisionOnly);
  const live = agents.find((a) => a.id === followId) ?? agents[0];

  // The landing stage follows the first real fleet agent: everything shown is its latest run.
  useEffect(() => {
    if (!followId && agents.length) follow(agents[0].id);
  }, [agents, followId, follow]);

  const avgMs = s.modelCalls ? s.modelMs / s.modelCalls : 0;
  const last = (["gate", "tp", "size", "direction"] as const).map((k) => s.decisions[k]).find(Boolean);

  return (
    <main>
      {/* HERO */}
      <section className="paper-grid border-b border-ink/10">
        <div className="mx-auto max-w-[1100px] px-4 pb-12 pt-12 text-center sm:pt-16">
          <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-bold shadow-btn">
            <span className="h-2 w-2 rounded-full bg-sun" /> Decision layer · OKX ATK · Avalanche Fuji
          </motion.span>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.08 }} className="mt-5 font-display text-[44px] uppercase leading-[0.95] tracking-tight sm:text-7xl">
            LLM&apos;ler yazar.
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">Karar modelleri karar verir.</span>
              <motion.span className="absolute inset-x-[-6px] bottom-1 z-0 h-[38%] origin-left bg-sun" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }} />
            </span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.25 }} className="mx-auto mt-5 max-w-[680px] text-lg font-medium text-ink/75 sm:text-xl">
            Trade ajanları ve şirket hazineleri için karar katmanı. Her adım iki karar modelinden gelen bir olasılık dağılımı: yetki zincirde, emirler OKX&apos;te, büyük kararlar insan onayında.
          </motion.p>
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.35 }} className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href="/agent" className="rounded-btn border-2 border-ink bg-sun px-5 py-3 font-bold shadow-btn transition-transform duration-150 hover:-translate-y-px">Trade ajanı fırlat →</Link>
            <Link href="/decision" className="rounded-btn border-2 border-ink bg-paper px-5 py-3 font-bold shadow-btn transition-transform duration-150 hover:-translate-y-px">Şirket risk masası →</Link>
            <Link href="/company" className="rounded-btn border border-ink/15 bg-paper px-5 py-3 font-bold">Şirketini bağla</Link>
          </motion.div>
          <div className="mt-6 flex flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-muted">
            <span>canlı ajan <b className="text-ink">{live?.name ?? "-"}</b></span>
            <span>model çağrısı <b className="text-ink">{s.modelCalls}</b></span>
            <span>ort. gecikme <b className="text-ink">{avgMs ? `${avgMs.toFixed(0)}ms` : "-"}</b></span>
            <span>son karar <b className="text-ink">{s.verdict ? s.verdict.toUpperCase() : "-"}</b></span>
            <span>ana model <b className="text-ink">{s.providers ? (s.providers.jev === "shadow" ? "shadow" : s.jevModel) : "-"}</b></span>
          </div>
        </div>
      </section>

      {/* LIVE STAGE: the latest run of a real fleet agent */}
      <section className="stage bg-stage text-white">
        <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 sm:px-6 sm:py-8">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="font-mono text-[10px] uppercase tracking-[.18em] text-sun">Canlı · filodaki ajanın son turu</p>
              <h2 className="mt-1 font-display text-3xl tracking-wide sm:text-4xl">{live ? `${live.name} · karar sahnesi` : "Karar sahnesi"}</h2>
            </div>
            <Link href="/agent" className="font-mono text-xs text-white/60 underline-offset-4 hover:text-sun hover:underline">tam sahne →</Link>
          </div>
          <div className="rounded-card border border-white/10 bg-white/[0.02] px-4 py-5">
            <PipelineRail s={s} />
          </div>
          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_340px]">
            <div className="rounded-card border border-white/10 bg-black/40 p-2">
              <div className="flex items-center justify-between px-3 pt-2">
                <h3 className="font-display text-xl tracking-wide">Olasılık alanı</h3>
                <span className="font-mono text-[10px] text-white/40">{s.providers ? `ana ${s.providers.jev === "shadow" ? "shadow" : s.jevModel}` : "hazır"}</span>
              </div>
              <div className="aspect-square w-full">
                <DecisionField s={s} />
              </div>
            </div>
            <div className="space-y-3">
              {s.decisions.pair && <DistributionCard d={s.decisions.pair} index={0} />}
              {last && <DistributionCard d={last} index={1} />}
              {!s.decisions.pair && <div className="grid h-40 place-items-center rounded-xl border border-dashed border-white/15 font-mono text-xs text-white/40">{agents.length ? "ajanın ilk turu bekleniyor" : "henüz ajan yok · Agent sayfasından fırlat"}</div>}
              <Link href="/decision" className="block rounded-xl border border-sun/30 bg-sun/[0.06] p-4 transition-colors hover:bg-sun/[0.1]">
                <div className="font-mono text-[10px] uppercase tracking-widest text-sun">Aynı katman · şirket hazinesi</div>
                <div className="mt-1 font-display text-xl tracking-wide">Risk masası: limitleri kod ölçer, müdahaleyi modeller seçer →</div>
              </Link>
            </div>
            <div className="h-[520px] xl:h-auto">
              <Ledger s={s} />
            </div>
          </div>
        </div>
      </section>

      {/* HOW */}
      <section className="border-b border-ink/10 bg-paper">
        <div className="mx-auto grid max-w-[1440px] gap-3 px-4 py-10 sm:grid-cols-2 sm:px-6 lg:grid-cols-4">
          {[
            ["01", "Model ve yetki", "Yerel karar modeli veya OpenRouter. Bütçe, pariteler, limitler; yetki hash'i ERC-8004 ile Fuji'de."],
            ["02", "Karar dağılımı", "Parite, yön, boyut, TP/SL, risk kapısı ya da şirket için müdahale: hepsi olasılık, metin yok."],
            ["03", "Yürütme ve kanıt", "OKX ATK ile spot emir + OCO. Kapanan işlem itibar olarak zincire, kararlar hash ile kayda."],
            ["04", "Agentic HR", "Şirketler pazardaki ajanları yönetim kuruluna kiralar; x402 ile öder, platform her kiralama ve hizmetten %10 alır."],
          ].map(([n, h, p]) => (
            <article key={n} className="rounded-card border border-ink/15 bg-paper p-5 shadow-card">
              <span className="font-mono text-xs text-muted">{n}</span>
              <h3 className="mt-2 font-display text-2xl uppercase">{h}</h3>
              <p className="mt-1 text-sm text-ink/65">{p}</p>
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}
