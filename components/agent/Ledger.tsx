"use client";

import { useEffect, useRef } from "react";
import { AnimatePresence, motion } from "framer-motion";
import type { AgentState } from "./useAgent";

const tone: Record<string, string> = {
  info: "text-white/70",
  jev: "text-sun",
  laya: "text-[rgb(64,214,196)]",
  ok: "text-[rgb(0,200,120)]",
  warn: "text-orange-300",
  err: "text-[rgb(255,80,80)]",
  llm: "text-violet-300",
};

export function Ledger({ s }: { s: AgentState }) {
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    box.current?.scrollTo({ top: box.current.scrollHeight, behavior: "smooth" });
  }, [s.logs.length]);
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-xl border border-white/10 bg-black">
      <div className="flex items-center gap-2 border-b border-white/10 px-3 py-2">
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="h-2.5 w-2.5 rounded-full bg-white/15" />
        <span className="ml-2 font-mono text-[11px] text-white/50">aviax-agent / events</span>
      </div>
      <div ref={box} className="flex-1 space-y-1.5 overflow-y-auto p-3 font-mono text-[11px] leading-relaxed scroll-thin" aria-live="polite">
        {s.logs.length === 0 && <p className="text-white/35">$ agent bekliyor. &quot;Agent&apos;ı başlat&quot; ile ilk run&apos;ı tetikle.</p>}
        <AnimatePresence initial={false}>
          {s.logs.map((l) => (
            <motion.div key={l.id} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }} transition={{ duration: 0.25 }} className="grid grid-cols-[44px_1fr] gap-2">
              <span className="text-white/30">{(l.t / 1000).toFixed(2)}</span>
              <span className={tone[l.tone ?? "info"] ?? tone.info}>
                {l.tool && <span className="mr-1 rounded bg-white/10 px-1 text-white/80">{l.tool}</span>}
                {l.text}
              </span>
            </motion.div>
          ))}
        </AnimatePresence>
        {s.running && <div className="caret text-white/40">$</div>}
      </div>
    </div>
  );
}
