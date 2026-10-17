"use client";

import { motion } from "framer-motion";
import { useEffect, useState } from "react";

const TEXT = "Piyasa koşullarına bakıldığında BTC için alım makul görünüyor, ancak volatilite nedeniyle dikkatli olmak gerekebilir ve bu bir yatırım tavsiyesi değildir...";
const TOKENS = TEXT.split(/(?<=\s)/);

/**
 * Side by side: an LLM agent writing its decision token by token vs a local decision
 * model returning a distribution in one forward pass. Latencies are what we measured.
 */
export function LlmVsDecision({ dark = false }: { dark?: boolean }) {
  const [tick, setTick] = useState(0);
  const [cycle, setCycle] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t >= TOKENS.length + 12 ? (setCycle((c) => c + 1), 0) : t + 1)), 110);
    return () => clearInterval(id);
  }, []);
  const shown = TOKENS.slice(0, Math.min(tick, TOKENS.length)).join("");
  const ms = Math.min(tick, TOKENS.length) * 110;
  const box = dark ? "border-white/10 bg-white/[0.03] text-white" : "border-ink/15 bg-paper text-ink shadow-card";
  const sub = dark ? "text-white/45" : "text-muted";
  // strands-decider's answer on our reference BTC state (measured during the build).
  const probs = [
    { k: "AL", p: 0.81, c: "bg-long" },
    { k: "BEKLE", p: 0.19, c: dark ? "bg-white/30" : "bg-ink/25" },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className={`rounded-card border p-4 ${box}`}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold uppercase tracking-widest">LLM ajanı · token token</span>
          <span className={`font-mono text-[11px] num ${sub}`}>{(ms / 1000).toFixed(1)}s · {Math.min(tick, TOKENS.length)} token</span>
        </div>
        <p className={`mt-3 min-h-[84px] text-sm leading-relaxed ${tick < TOKENS.length ? "caret" : ""}`}>{shown}</p>
        <p className={`mt-2 font-mono text-[11px] ${sub}`}>Çıktı: metin. Ölçümümüz: ücretsiz LLM'lerle bir karar turu 4–108 sn, bazen boş ya da bozuk JSON.</p>
      </div>
      <div className={`rounded-card border-2 p-4 ${dark ? "border-sun/60 bg-sun/[0.06] text-white" : "border-ink bg-sun/20 text-ink shadow-brut"}`}>
        <div className="flex items-center justify-between">
          <span className="font-mono text-[11px] font-bold tracking-widest">KARAR MODELİ · strands-decider</span>
          <span className="font-mono text-[11px] num">~20–900 ms · 1 pass</span>
        </div>
        <div className="mt-3 space-y-2">
          {probs.map((r, i) => (
            <div key={r.k} className="grid grid-cols-[48px_1fr_40px] items-center gap-2 font-mono text-xs">
              <span className="font-bold">{r.k}</span>
              <div className={`h-3 overflow-hidden rounded-full ${dark ? "bg-white/10" : "bg-ink/10"}`}>
                <motion.div key={cycle} className={`h-full rounded-full ${r.c}`} initial={{ width: 0 }} animate={{ width: `${r.p * 100}%` }} transition={{ duration: 0.25, delay: 0.04 * i }} />
              </div>
              <span className="text-right num">{(r.p * 100).toFixed(0)}%</span>
            </div>
          ))}
        </div>
        <p className="mt-3 font-mono text-[11px] opacity-70">Çıktı: olasılık dağılımı. Aynı girdi, aynı çıktı. Doğrudan risk kuralına bağlanır.</p>
      </div>
    </div>
  );
}
