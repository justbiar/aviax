"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { usePoll } from "@/lib/usePoll";
import { AgentCard, AgentForm, type FleetAgentView } from "@/components/agent/Fleet";
import { useAgent } from "@/components/agent/useAgent";
import { DecisionField } from "@/components/agent/DecisionField";
import { PipelineRail } from "@/components/agent/PipelineRail";
import { WorkerGrid } from "@/components/agent/WorkerGrid";
import { Ledger } from "@/components/agent/Ledger";
import { DistributionCard } from "@/components/agent/DistributionCard";
import { PlanView } from "@/components/agent/PlanView";
import { CandleChart, type Overlay } from "@/components/trade/CandleChart";
import { short } from "@/lib/fmt";

const EASE = [0.22, 1, 0.36, 1] as const;
const ORDER = ["direction", "size", "leverage", "tp", "sl", "gate"] as const;

export default function AgentPage() {
  const { s, run, follow } = useAgent();
  const [selected, setSelected] = useState<string | null>(null);
  const { data: fleet, reload } = usePoll<FleetAgentView[]>("/api/fleet", 3000);
  const agents = fleet ?? [];
  const current = agents.find((a) => a.id === selected);

  // Auto-follow the first agent when the page opens.
  useEffect(() => {
    if (!selected && agents.length && !s.running && !s.logs.length) {
      setSelected(agents[0].id);
      follow(agents[0].id);
    }
  }, [agents, selected, s.running, s.logs.length, follow]);

  const overlays: Overlay[] = useMemo(
    () =>
      s.plan
        ? [
            { price: s.plan.entry, color: "rgb(255,199,0)", title: "Giriş" },
            { price: s.plan.tp, color: "rgb(0,200,120)", title: "TP", dashed: true },
            { price: s.plan.sl, color: "rgb(255,80,80)", title: "SL", dashed: true },
          ]
        : [],
    [s.plan],
  );
  const chartInst = s.plan?.instId ?? s.decisions.pair?.pick;
  const avgMs = s.modelCalls ? s.modelMs / s.modelCalls : 0;

  return (
    <main>
      {/* HERO */}
      <section className="paper-grid border-b border-ink/10">
        <div className="mx-auto max-w-[1100px] px-4 pb-12 pt-12 text-center sm:pt-16">
          <motion.span initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease: EASE }} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-bold shadow-btn">
            <span className="h-2 w-2 rounded-full bg-sun" /> Prediction-native trading agent · OKX ATK
          </motion.span>
          <motion.h1 initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7, ease: EASE, delay: 0.08 }} className="mt-5 font-display text-[44px] uppercase leading-[0.95] tracking-tight sm:text-7xl">
            LLM&apos;ler konuşur.
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">JEV karar verir.</span>
              <motion.span className="absolute inset-x-[-6px] bottom-1 z-0 h-[38%] origin-left bg-sun" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.7, ease: EASE, delay: 0.5 }} />
            </span>
          </motion.h1>
          <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.6, delay: 0.25 }} className="mx-auto mt-5 max-w-[640px] text-lg font-medium text-ink/75 sm:text-xl">
            Parite, yön, boyut, TP ve SL. Her karar JEV ve LAYA&apos;dan gelen bir olasılık dağılımı. Metin yok, tahmin var.
          </motion.p>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE, delay: 0.35 }} className="mx-auto mt-8 max-w-[860px]">
            <AgentForm onCreated={(id) => { setSelected(id); follow(id); reload(); }} />
            <div className="mt-3 text-center">
              <button
                onClick={() => { setSelected(null); follow(null); run({ execute: false, universe: 6, pace: 1 }); }}
                disabled={s.running}
                className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline disabled:opacity-50"
              >
                Emirsiz deneme turu izle
              </button>
            </div>
          </motion.div>
          <div className="mt-4 flex flex-wrap justify-center gap-x-6 gap-y-1 font-mono text-xs text-muted">
            <span>model çağrısı <b className="text-ink">{s.modelCalls}</b></span>
            <span>ort. gecikme <b className="text-ink">{avgMs ? `${avgMs.toFixed(0)}ms` : "-"}</b></span>
            <span>run süresi <b className="text-ink">{s.totalMs ? `${(s.totalMs / 1000).toFixed(2)}s` : "-"}</b></span>
            <span>JEV kaynağı <b className="text-ink">{s.providers ? (s.providers.jev === "openrouter" ? s.jevModel : s.providers.jev) : "-"}</b></span>
          </div>
        </div>
      </section>

      {/* FLEET */}
      {agents.length > 0 && (
        <section className="border-b border-ink/10 bg-paper">
          <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
              <h2 className="font-display text-3xl uppercase tracking-wide">Ajan filosu</h2>
              <span className="font-mono text-xs text-muted">
                toplam bakiye <b className="text-ink">{agents.reduce((t, a) => t + a.equity, 0).toFixed(2)} USDT</b> · {agents.filter((a) => a.position).length} açık pozisyon
              </span>
            </div>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <AnimatePresence>
                {agents.map((a) => (
                  <AgentCard key={a.id} a={a} selected={a.id === selected} onSelect={() => { setSelected(a.id); follow(a.id); }} />
                ))}
              </AnimatePresence>
            </div>
          </div>
        </section>
      )}

      {/* STAGE */}
      <section className="stage bg-stage text-white">
        <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 sm:px-6 sm:py-8">
          <div className="rounded-card border border-white/10 bg-white/[0.02] px-4 py-5">
            <PipelineRail s={s} />
          </div>

          <div className="grid gap-4 xl:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)_340px]">
            <div className="rounded-card border border-white/10 bg-black/40 p-2">
              <div className="flex items-center justify-between px-3 pt-2">
                <h2 className="font-display text-xl tracking-wide">{current ? `${current.name} · olasılık alanı` : "Olasılık alanı"}</h2>
                <span className="font-mono text-[10px] text-white/40">{s.providers ? `JEV ${s.providers.jev === "openrouter" ? s.jevModel : s.providers.jev} · LAYA ${s.providers.laya}` : "hazır"}</span>
              </div>
              <div className="aspect-square w-full">
                <DecisionField s={s} />
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="font-display text-xl tracking-wide">Paralel worker&apos;lar</h2>
                <span className="font-mono text-[10px] text-white/40">her worker: 2 forward pass</span>
              </div>
              <WorkerGrid s={s} />
              {s.decisions.pair && <DistributionCard d={s.decisions.pair} index={0} />}
            </div>

            <div className="h-[520px] xl:h-auto">
              <Ledger s={s} />
            </div>
          </div>

          <AnimatePresence>
            {Object.keys(s.decisions).some((k) => k !== "pair") && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="space-y-3">
                <h2 className="font-display text-xl tracking-wide">Karar dağılımları</h2>
                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {ORDER.map((k, i) => {
                    const d = s.decisions[k];
                    return d ? <DistributionCard key={k} d={d} index={i} /> : null;
                  })}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {s.plan && (
            <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: EASE }} className="grid gap-4 xl:grid-cols-2">
              <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
                <h2 className="mb-2 font-display text-xl tracking-wide">TP / SL olasılık merdiveni</h2>
                <PlanView s={s} />
              </div>
              <div className="overflow-hidden rounded-card border border-white/10 bg-white/[0.02]">
                <div className="flex items-center justify-between px-4 pt-4">
                  <h2 className="font-display text-xl tracking-wide">{chartInst ? short(chartInst) : ""} · canlı</h2>
                </div>
                {chartInst && <CandleChart instId={chartInst} overlays={overlays} dark height={330} />}
              </div>
            </motion.div>
          )}

          {s.narrations.length > 0 && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="rounded-card border border-violet-300/20 bg-violet-300/[0.05] p-4">
              <div className="font-mono text-[10px] uppercase tracking-widest text-violet-300">LLM anlatıcı (OpenRouter) · karar vermez, sadece açıklar</div>
              {s.narrations.map((t, i) => (
                <p key={i} className="mt-2 max-w-[900px] text-sm leading-relaxed text-white/85">{t}</p>
              ))}
            </motion.div>
          )}
        </div>
      </section>
    </main>
  );
}
