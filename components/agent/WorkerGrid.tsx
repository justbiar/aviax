"use client";

import { motion } from "framer-motion";
import type { AgentState } from "./useAgent";
import { fmtPct, fmtPx, short } from "@/lib/fmt";

function Spark({ xs, up }: { xs: number[]; up: boolean }) {
  if (xs.length < 2) return null;
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  const pts = xs.map((v, i) => `${(i / (xs.length - 1)) * 100},${28 - ((v - min) / (max - min || 1)) * 26}`).join(" ");
  return (
    <svg viewBox="0 0 100 30" className="h-8 w-full" preserveAspectRatio="none" aria-hidden>
      <polyline points={pts} fill="none" stroke={up ? "rgb(0,200,120)" : "rgb(255,80,80)"} strokeWidth="1.4" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Stack({ p, label, color }: { p: Record<string, number>; label: string; color: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-9 font-mono text-[9px] font-bold ${color}`}>{label}</span>
      <div className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-white/5">
        <motion.div className="bg-[rgb(0,200,120)]" initial={{ width: 0 }} animate={{ width: `${p.long * 100}%` }} transition={{ duration: 0.7 }} />
        <motion.div className="bg-white/25" initial={{ width: 0 }} animate={{ width: `${p.flat * 100}%` }} transition={{ duration: 0.7 }} />
        <motion.div className="bg-[rgb(255,80,80)]" initial={{ width: 0 }} animate={{ width: `${p.short * 100}%` }} transition={{ duration: 0.7 }} />
      </div>
    </div>
  );
}

export function WorkerGrid({ s }: { s: AgentState }) {
  const slots = s.pairs.length ? s.pairs : Array.from({ length: 6 }, () => null);
  return (
    <div className="grid grid-cols-2 gap-2 md:grid-cols-3">
      {slots.map((p, i) => {
        const w = p ? s.workers[p.instId] : undefined;
        const chosen = p && s.decisions.pair?.pick === p.instId;
        const status = !p ? "WAIT" : w ? (chosen ? "SELECTED" : "PREDICTED") : s.running ? "PREDICTING" : "READY";
        return (
          <motion.div
            key={p?.instId ?? i}
            layout
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, delay: i * 0.05 }}
            className={`rounded-xl border p-3 transition-colors duration-300 ${chosen ? "border-sun bg-sun/[0.07]" : "border-white/10 bg-white/[0.03]"}`}
          >
            <div className="flex items-center justify-between font-mono text-[10px]">
              <span className="text-white/40">W{String(i + 1).padStart(2, "0")}</span>
              <span className={chosen ? "text-sun" : w ? "text-[rgb(64,214,196)]" : "text-white/40"}>
                {status === "PREDICTING" && <span className="caret" />}
                {status}
              </span>
            </div>
            {p ? (
              <>
                <div className="mt-1 flex items-baseline justify-between">
                  <span className="font-display text-xl tracking-wide text-white">{short(p.instId)}</span>
                  <span className={`font-mono text-[11px] ${p.chg24h >= 0 ? "text-[rgb(0,200,120)]" : "text-[rgb(255,80,80)]"}`}>{fmtPct(p.chg24h)}</span>
                </div>
                <div className="font-mono text-[10px] text-white/45">{fmtPx(p.last)} · RSI {p.rsi.toFixed(0)} · ATR {p.atrPct.toFixed(2)}%</div>
                <Spark xs={p.spark} up={p.spark[p.spark.length - 1] >= p.spark[0]} />
                <div className="mt-1 space-y-1">
                  {w ? (
                    <>
                      <Stack p={w.jev.answers.direction.probabilities} label="JEV" color="text-sun" />
                      <Stack p={w.laya.answers.direction.probabilities} label="LAYA" color="text-[rgb(64,214,196)]" />
                      <div className="flex justify-between pt-1 font-mono text-[9px] text-white/40">
                        <span>{w.jev.latencyMs}ms · {w.laya.latencyMs}ms</span>
                        <span>edge {w.edge.toFixed(2)}</span>
                      </div>
                    </>
                  ) : (
                    <div className="h-[46px] animate-pulse rounded bg-white/5" />
                  )}
                </div>
              </>
            ) : (
              <div className="mt-2 h-[110px] rounded bg-white/[0.03]" />
            )}
          </motion.div>
        );
      })}
    </div>
  );
}
