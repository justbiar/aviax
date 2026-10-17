"use client";

import { AnimatePresence, motion } from "framer-motion";
import type { FleetAgentView } from "./Fleet";

const KIND: Record<string, { t: string; c: string }> = {
  register: { t: "ERC-8004", c: "bg-sun text-black" },
  x402: { t: "x402", c: "bg-[rgb(64,214,196)] text-black" },
  reputation: { t: "İTİBAR", c: "bg-[rgb(0,200,120)] text-black" },
  fund: { t: "FON", c: "bg-white/80 text-black" },
  error: { t: "HATA", c: "bg-[rgb(255,80,80)] text-white" },
  info: { t: "BİLGİ", c: "bg-white/15 text-white" },
};

/** On-chain trail of the followed agent on Avalanche Fuji. */
export function ChainPanel({ a }: { a: FleetAgentView }) {
  if (!a.chain.enabled) return null;
  return (
    <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <h2 className="font-display text-xl tracking-wide">Avalanche Fuji · zincir kayıtları</h2>
        <div className="flex flex-wrap gap-3 font-mono text-[11px] text-white/60">
          <span>agentId <b className="text-white">{a.chain.agentId ? `#${a.chain.agentId}` : "-"}</b></span>
          <span>yetki hash <b className="text-white">{a.chain.mandateHash ? `${a.chain.mandateHash.slice(0, 10)}…` : "-"}</b></span>
          <span>x402 <b className="text-white">{a.chain.payments} ödeme · {a.chain.paidUsdc.toFixed(2)} USDC</b></span>
          <span>itibar <b className="text-white">{a.chain.feedbacks}</b></span>
        </div>
      </div>
      <div className="max-h-[260px] space-y-1.5 overflow-y-auto scroll-thin">
        <AnimatePresence initial={false}>
          {a.chain.log.map((l) => {
            const k = KIND[l.kind] ?? KIND.info;
            return (
              <motion.div key={l.at + l.text} initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} className="grid grid-cols-[64px_74px_1fr] items-center gap-2 font-mono text-[11px]">
                <span className="text-white/35">{new Date(l.at).toLocaleTimeString("tr-TR")}</span>
                <span className={`rounded px-1.5 py-0.5 text-center text-[10px] font-bold ${k.c}`}>{k.t}</span>
                <span className="min-w-0 truncate text-white/85">
                  {l.text}
                  {l.tx && (
                    <a href={l.tx} target="_blank" rel="noreferrer" className="ml-2 text-sun underline-offset-2 hover:underline">
                      tx ↗
                    </a>
                  )}
                </span>
              </motion.div>
            );
          })}
        </AnimatePresence>
        {a.chain.log.length === 0 && <p className="font-mono text-xs text-white/40">Henüz zincir kaydı yok.</p>}
      </div>
    </div>
  );
}
