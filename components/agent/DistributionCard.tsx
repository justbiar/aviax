"use client";

import { motion } from "framer-motion";
import type { DecisionEv } from "./useAgent";

const EASE = [0.22, 1, 0.36, 1] as const;
const TYPE: Record<string, string> = { choice: "choice", score: "score", noul: "noul (yes/no)" };

export function DistributionCard({ d, index }: { d: DecisionEv; index: number }) {
  const labels = Object.keys(d.jev.probabilities);
  const ens = Object.fromEntries(labels.map((k) => [k, 0.6 * d.jev.probabilities[k] + 0.4 * (d.laya.probabilities[k] ?? 0)]));
  const pickLabel = d.key === "size" || d.key === "leverage" ? labels.reduce((b, k) => (ens[k] > ens[b] ? k : b), labels[0]) : d.pick;
  const NICE: Record<string, string> = { long: "AL", flat: "BEKLE", short: "SAT" };
  const nice = (k: string) => d.labels?.[k] ?? NICE[k] ?? k.replace("-USDT-SWAP", "").replace("-USDT", "");
  const conf = Math.max(...Object.values(ens));

  return (
    <motion.div
      initial={{ opacity: 0, y: 14, filter: "blur(4px)" }}
      animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
      transition={{ duration: 0.5, ease: EASE, delay: index * 0.04 }}
      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
    >
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-mono text-[10px] uppercase tracking-widest text-white/40">{TYPE[d.jev.type]}</div>
          <div className="font-display text-lg tracking-wide text-white">{d.title}</div>
        </div>
        <div className="text-right">
          <div className="font-display text-xl text-sun">{d.key === "gate" ? (d.pick === "yes" ? "GEÇTİ" : "RED") : d.key === "pair" ? nice(d.pick) : d.key === "tp" || d.key === "sl" || d.key === "direction" ? nice(d.pick) : d.pick.toUpperCase()}</div>
          <div className="font-mono text-[10px] text-white/45">ensemble {(conf * 100).toFixed(0)}%</div>
        </div>
      </div>

      <div className="mt-3 space-y-1.5">
        {labels.map((k, i) => {
          const isPick = k === pickLabel;
          return (
            <div key={k} className="grid grid-cols-[1fr_72px_1fr] items-center gap-2">
              <div className="flex h-3 justify-end overflow-hidden rounded-l-full bg-white/[0.04]">
                <motion.div className="h-full rounded-l-full bg-sun" style={{ opacity: isPick ? 1 : 0.45 }} initial={{ width: 0 }} animate={{ width: `${d.jev.probabilities[k] * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: 0.1 + i * 0.05 }} />
              </div>
              <div className={`truncate text-center font-mono text-[10px] ${isPick ? "font-bold text-white" : "text-white/50"}`} title={k}>
                {nice(k)}
              </div>
              <div className="flex h-3 overflow-hidden rounded-r-full bg-white/[0.04]">
                <motion.div className="h-full rounded-r-full bg-[rgb(64,214,196)]" style={{ opacity: isPick ? 1 : 0.45 }} initial={{ width: 0 }} animate={{ width: `${(d.laya.probabilities[k] ?? 0) * 100}%` }} transition={{ duration: 0.8, ease: EASE, delay: 0.15 + i * 0.05 }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/10 pt-2 font-mono text-[10px]">
        <span className="text-sun">JEV {d.jevMs}ms</span>
        <span className="truncate px-2 text-white/35" title={d.jevSrc}>
          {d.jevProvider === "typesafe" ? "1 forward pass · 0 token" : d.jevProvider === "openrouter" ? d.jevSrc.replace("openrouter:", "") : "shadow estimator"}
        </span>
        <span className="text-[rgb(64,214,196)]">LAYA {d.layaMs}ms</span>
      </div>
    </motion.div>
  );
}
