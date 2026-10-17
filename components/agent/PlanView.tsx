"use client";

import { motion } from "framer-motion";
import type { AgentState } from "./useAgent";
import { fmtPx, short } from "@/lib/fmt";

const EASE = [0.22, 1, 0.36, 1] as const;

/** Price ladder: every TP / SL candidate is a band whose opacity is its probability. */
export function PlanView({ s }: { s: AgentState }) {
  const p = s.plan;
  const tpD = s.decisions.tp;
  const slD = s.decisions.sl;
  if (!p || !tpD || !slD) return null;
  const sign = p.side === "long" ? 1 : -1;
  const atr = Math.abs(p.tp - p.entry) / p.tpAtr;
  const tpOpts = Object.keys(tpD.jev.probabilities).map((k) => ({ k, m: Number(k.replace("tp_", "").replace("_", ".")), p: 0.6 * tpD.jev.probabilities[k] + 0.4 * tpD.laya.probabilities[k] }));
  const slOpts = Object.keys(slD.jev.probabilities).map((k) => ({ k, m: Number(k.replace("sl_", "").replace("_", ".")), p: 0.6 * slD.jev.probabilities[k] + 0.4 * slD.laya.probabilities[k] }));
  const H = 300;
  const top = 3.3; // ATR above entry in direction of profit
  const bot = 2.3;
  const y = (m: number) => 20 + ((top - m) / (top + bot)) * (H - 40); // m in ATR, + = profit direction

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_260px]">
      <svg viewBox={`0 0 520 ${H}`} className="w-full" role="img" aria-label="TP ve SL olasılık merdiveni">
        <line x1={70} x2={70} y1={10} y2={H - 10} stroke="white" strokeOpacity={0.15} />
        {tpOpts.map((o, i) => (
          <motion.g key={o.k} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: i * 0.08, duration: 0.5, ease: EASE }}>
            <rect x={70} y={y(o.m) - 9} width={420 * o.p + 10} height={18} rx={4} fill="rgb(0,200,120)" fillOpacity={0.12 + o.p * 0.8} />
            <text x={62} y={y(o.m) + 4} textAnchor="end" fontSize={10} className="font-mono" fill="white" fillOpacity={0.6}>{fmtPx(p.entry + sign * o.m * atr)}</text>
            <text x={80 + 420 * o.p + 10} y={y(o.m) + 4} fontSize={10} className="font-mono" fill="white" fillOpacity={o.k === tpD.pick ? 1 : 0.5}>
              TP {o.m} ATR · {(o.p * 100).toFixed(0)}%
            </text>
          </motion.g>
        ))}
        {slOpts.map((o, i) => (
          <motion.g key={o.k} initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.3 + i * 0.08, duration: 0.5, ease: EASE }}>
            <rect x={70} y={y(-o.m) - 9} width={420 * o.p + 10} height={18} rx={4} fill="rgb(255,80,80)" fillOpacity={0.12 + o.p * 0.8} />
            <text x={62} y={y(-o.m) + 4} textAnchor="end" fontSize={10} className="font-mono" fill="white" fillOpacity={0.6}>{fmtPx(p.entry - sign * o.m * atr)}</text>
            <text x={80 + 420 * o.p + 10} y={y(-o.m) + 4} fontSize={10} className="font-mono" fill="white" fillOpacity={o.k === slD.pick ? 1 : 0.5}>
              SL {o.m} ATR · {(o.p * 100).toFixed(0)}%
            </text>
          </motion.g>
        ))}
        <line x1={40} x2={510} y1={y(0)} y2={y(0)} stroke="rgb(255,199,0)" strokeWidth={2} />
        <text x={62} y={y(0) - 6} textAnchor="end" fontSize={10} className="font-mono" fill="rgb(255,199,0)">{fmtPx(p.entry)}</text>
        <text x={510} y={y(0) - 6} textAnchor="end" fontSize={10} className="font-mono" fill="rgb(255,199,0)">GİRİŞ · {p.side.toUpperCase()}</text>
        <motion.line x1={70} x2={510} y1={y(p.tpAtr)} y2={y(p.tpAtr)} stroke="rgb(0,200,120)" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.7, duration: 0.8 }} />
        <motion.line x1={70} x2={510} y1={y(-p.slAtr)} y2={y(-p.slAtr)} stroke="rgb(255,80,80)" strokeDasharray="4 4" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ delay: 0.8, duration: 0.8 }} />
      </svg>

      <div className="space-y-2 font-mono text-xs">
        <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
          <div className="text-[10px] uppercase tracking-widest text-white/40">Emir planı</div>
          <div className={`font-display text-3xl tracking-wide ${p.side === "long" ? "text-[rgb(0,200,120)]" : "text-[rgb(255,80,80)]"}`}>
            {p.side.toUpperCase()} {short(p.instId)}
          </div>
          <dl className="mt-2 grid grid-cols-2 gap-y-1 text-white/80">
            <dt className="text-white/40">Notional</dt><dd className="text-right">{p.notional} USDT</dd>
            <dt className="text-white/40">Kontrat</dt><dd className="text-right">{p.contracts}</dd>
            <dt className="text-white/40">Kaldıraç</dt><dd className="text-right">{p.leverage}x</dd>
            <dt className="text-white/40">TP</dt><dd className="text-right text-[rgb(0,200,120)]">{fmtPx(p.tp)}</dd>
            <dt className="text-white/40">SL</dt><dd className="text-right text-[rgb(255,80,80)]">{fmtPx(p.sl)}</dd>
            <dt className="text-white/40">R : R</dt><dd className="text-right">{p.rr.toFixed(2)}</dd>
            <dt className="text-white/40">p(EV&gt;0)</dt><dd className="text-right text-sun">{(p.gate * 100).toFixed(1)}%</dd>
          </dl>
        </div>
        <div className={`rounded-xl border p-3 ${s.order ? (s.order.ok ? "border-[rgb(0,200,120)]/50 bg-[rgb(0,200,120)]/10" : "border-[rgb(255,80,80)]/50 bg-[rgb(255,80,80)]/10") : "border-white/10 bg-white/[0.03]"}`}>
          <div className="text-[10px] uppercase tracking-widest text-white/40">ATK · swap_place_order</div>
          <div className="mt-1 text-white">
            {s.order ? (s.order.ok ? `Gönderildi · ${s.order.ordId}` : s.order.detail) : s.verdict === "planned" ? "Plan modu: emir gönderilmedi" : s.verdict === "hold" ? "Kapı reddetti: HOLD" : "Bekliyor..."}
          </div>
        </div>
      </div>
    </div>
  );
}
