"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useMemo } from "react";
import type { AgentState } from "./useAgent";
import { short } from "@/lib/fmt";

/**
 * The probability field. Every candidate pair owns a sector on the outer ring.
 * Spiral filaments stream from the agent core to each sector; their weight is
 * the probability mass JEV (amber) and LAYA (teal) put on that pair. Inner rings
 * show the direction distribution and the risk-gate probability.
 */

const C = 320;
const R_OUT = 268;
const R_DIR = 128;
const R_GATE = 104;
const FILAMENTS = 15;
const EASE = [0.22, 1, 0.36, 1] as const;

const r2 = (v: number) => Math.round(v * 100) / 100;
const polar = (r: number, a: number) => [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))] as const;

function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

/** Spiral stream from near the core to the sector, twisting counter-clockwise like a wave. */
function spiral(target: number, offset: number, twist: number) {
  const a = target + offset;
  const [sx, sy] = polar(R_GATE + 14, a - twist * 1.15);
  const [c1x, c1y] = polar(R_DIR + 70, a - twist * 0.85);
  const [c2x, c2y] = polar(R_OUT - 70, a - twist * 0.25);
  const [ex, ey] = polar(R_OUT - 14, a);
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
}

export function DecisionField({ s }: { s: AgentState }) {
  const n = Math.max(s.pairs.length, 6);
  const span = (Math.PI * 2) / n;
  const pairDec = s.decisions.pair;
  const dirDec = s.decisions.direction;
  const gateDec = s.decisions.gate;
  const chosen = pairDec?.pick;

  const sectors = useMemo(
    () =>
      Array.from({ length: n }, (_, i) => {
        const p = s.pairs[i];
        const mid = -Math.PI / 2 + i * span;
        const w = p ? s.workers[p.instId] : undefined;
        const pj = p && pairDec ? pairDec.jev.probabilities[p.instId] ?? 0 : undefined;
        const pl = p && pairDec ? pairDec.laya.probabilities[p.instId] ?? 0 : undefined;
        // Before the pair decision, use each worker's edge as provisional weight.
        const provisional = w ? Math.max(0.05, Math.min(1, w.edge)) : 0;
        return { i, p, mid, w, pj, pl, provisional };
      }),
    [n, span, s.pairs, s.workers, pairDec],
  );

  const ens = (k: string) => (dirDec ? 0.6 * (dirDec.jev.probabilities[k] ?? 0) + 0.4 * (dirDec.laya.probabilities[k] ?? 0) : 0);
  const dir = dirDec ? { long: ens("long"), flat: ens("flat"), short: ens("short") } : null;
  const gate = gateDec ? 0.6 * (gateDec.jev.value ?? 0) + 0.4 * (gateDec.laya.value ?? 0) : null;

  const center = (() => {
    if (s.plan && gate !== null) return { top: gateDec?.pick === "yes" ? "EXECUTE" : "HOLD", big: `${Math.round(gate * 100)}%`, sub: "p(EV > 0)" };
    if (dirDec && dir) return { top: dirDec.pick === "long" ? "AL" : dirDec.pick === "flat" ? "BEKLE" : dirDec.pick.toUpperCase(), big: `${Math.round(Math.max(dir.long, dir.short, dir.flat) * 100)}%`, sub: "yön olasılığı" };
    if (pairDec && chosen) return { top: short(chosen), big: `${Math.round((0.6 * pairDec.jev.probabilities[chosen] + 0.4 * pairDec.laya.probabilities[chosen]) * 100)}%`, sub: "parite olasılığı" };
    if (s.running) return { top: s.current?.toUpperCase() ?? "BOOT", big: `${Object.keys(s.workers).length}/${s.pairs.length || "-"}`, sub: "worker" };
    return { top: "IDLE", big: "p(·)", sub: "dağılım bekleniyor" };
  })();

  return (
    <svg viewBox="0 0 640 640" className="h-full w-full" role="img" aria-label="JEV ve LAYA olasılık alanı">
      <defs>
        <radialGradient id="core" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="rgb(255,199,0)" stopOpacity="0.35" />
          <stop offset="60%" stopColor="rgb(255,199,0)" stopOpacity="0.05" />
          <stop offset="100%" stopColor="rgb(255,199,0)" stopOpacity="0" />
        </radialGradient>
        <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>

      {/* concentric guides */}
      {[R_OUT, 210, 160, R_DIR, R_GATE].map((r) => (
        <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="white" strokeOpacity={0.05} />
      ))}
      <circle cx={C} cy={C} r={R_GATE - 6} fill="url(#core)" />

      {/* idle / scanning rotating tick ring */}
      <motion.g
        style={{ originX: `${C}px`, originY: `${C}px` }}
        animate={{ rotate: s.running ? 360 : 0 }}
        transition={{ duration: 24, repeat: s.running ? Infinity : 0, ease: "linear" }}
      >
        {Array.from({ length: 120 }, (_, i) => {
          const a = (i / 120) * Math.PI * 2;
          const [x0, y0] = polar(R_OUT + 10, a);
          const [x1, y1] = polar(R_OUT + (i % 10 === 0 ? 20 : 15), a);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="white" strokeOpacity={i % 10 === 0 ? 0.35 : 0.12} />;
        })}
      </motion.g>

      {/* filaments */}
      {sectors.map(({ i, p, mid, w, pj, pl, provisional }) => {
        const isChosen = chosen && p?.instId === chosen;
        const faded = chosen && !isChosen;
        return (
          <g key={i}>
            {Array.from({ length: FILAMENTS }, (_, k) => {
              const t = k / (FILAMENTS - 1) - 0.5;
              const off = t * span * 0.62;
              const isJev = k % 2 === 0;
              const prob = pj !== undefined ? (isJev ? pj : pl!) : provisional * 0.5;
              const width = w ? 0.6 + prob * (isChosen ? 9 : 6) * (1 - Math.abs(t) * 1.2) : 0.6;
              const color = !w ? "rgb(255,255,255)" : isJev ? "rgb(255,199,0)" : "rgb(64,214,196)";
              const op = !w ? 0.08 : faded ? 0.13 : isChosen ? 0.95 : 0.25 + prob * 0.9;
              return (
                <motion.path
                  key={k}
                  d={spiral(mid, off, 0.9 + k * 0.025)}
                  fill="none"
                  stroke={color}
                  strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }}
                  animate={{ pathLength: p ? 1 : 0.35, opacity: op, strokeWidth: Math.max(0.5, width) }}
                  transition={{ duration: 1.1, delay: w ? k * 0.03 : i * 0.05, ease: EASE }}
                  filter={isChosen ? "url(#glow)" : undefined}
                />
              );
            })}
            {/* scanning pulse traveling along the middle filament */}
            {p && !w && s.running && (
              <path d={spiral(mid, 0, 1.06)} fill="none" stroke="white" strokeOpacity={0.5} strokeWidth={1.2} className="flow" />
            )}
          </g>
        );
      })}

      {/* outer sectors */}
      {sectors.map(({ i, p, mid, w, pj, pl }) => {
        const a0 = mid - span / 2 + 0.03;
        const a1 = mid + span / 2 - 0.03;
        const isChosen = chosen && p?.instId === chosen;
        const ens = pj !== undefined ? 0.6 * pj + 0.4 * (pl ?? 0) : undefined;
        const [lx, ly] = polar(R_OUT + 44, mid);
        const anchor = Math.abs(Math.cos(mid)) < 0.25 ? "middle" : Math.cos(mid) > 0 ? "start" : "end";
        return (
          <g key={"s" + i}>
            <path d={arc(R_OUT, a0, a1)} fill="none" stroke="white" strokeOpacity={0.12} strokeWidth={12} />
            {w && (
              <motion.path
                d={arc(R_OUT, a0, a1)}
                fill="none"
                stroke={isChosen ? "rgb(255,199,0)" : "white"}
                strokeWidth={12}
                initial={{ pathLength: 0 }}
                animate={{ pathLength: ens !== undefined ? Math.max(0.04, ens) : Math.min(1, w.edge), strokeOpacity: chosen && !isChosen ? 0.2 : 0.85 }}
                transition={{ duration: 0.9, ease: EASE }}
              />
            )}
            {p && (
              <text x={lx} y={ly} textAnchor={anchor} dominantBaseline="middle" className="font-display" fontSize={isChosen ? 24 : 18} fill={isChosen ? "rgb(255,199,0)" : "white"} fillOpacity={chosen && !isChosen ? 0.35 : 0.9} letterSpacing="0.04em">
                {short(p.instId)}
                <tspan x={lx} dy={18} className="font-mono" fontSize={10} fill="white" fillOpacity={0.5} letterSpacing="0">
                  {ens !== undefined ? `p=${(ens * 100).toFixed(1)}%` : `${p.chg24h >= 0 ? "+" : ""}${p.chg24h.toFixed(2)}%`}
                </tspan>
              </text>
            )}
          </g>
        );
      })}

      {/* direction ring */}
      {dir && (
        <g>
          {(() => {
            let a = -Math.PI / 2;
            return (["long", "flat", "short"] as const).map((k) => {
              const sweep = dir[k] * Math.PI * 2;
              const d = arc(R_DIR, a + 0.02, a + Math.max(0.03, sweep) - 0.02);
              const mid = a + sweep / 2;
              a += sweep;
              const [tx, ty] = polar(R_DIR + 18, mid);
              const col = k === "long" ? "rgb(0,200,120)" : k === "short" ? "rgb(255,80,80)" : "rgb(160,160,160)";
              return (
                <g key={k}>
                  <motion.path d={d} fill="none" stroke={col} strokeWidth={dirDec?.pick === k ? 10 : 5} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.8, ease: EASE }} />
                  {dir[k] > 0.08 && (
                    <text x={tx} y={ty} textAnchor="middle" dominantBaseline="middle" fontSize={9} className="font-mono" fill={col}>
                      {k === "long" ? "AL" : k === "flat" ? "BEKLE" : "S"} {(dir[k] * 100).toFixed(0)}
                    </text>
                  )}
                </g>
              );
            });
          })()}
        </g>
      )}

      {/* gate ring */}
      <circle cx={C} cy={C} r={R_GATE} fill="none" stroke="white" strokeOpacity={0.08} strokeWidth={4} />
      {gate !== null && (
        <motion.circle
          cx={C}
          cy={C}
          r={R_GATE}
          fill="none"
          stroke={gateDec?.pick === "yes" ? "rgb(255,199,0)" : "rgb(255,80,80)"}
          strokeWidth={4}
          strokeLinecap="round"
          transform={`rotate(-90 ${C} ${C})`}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: gate }}
          transition={{ duration: 1.2, ease: EASE }}
        />
      )}

      {/* core readout */}
      <AnimatePresence mode="wait">
        <motion.g key={center.top + center.big} initial={{ opacity: 0, scale: 0.92 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 1.06 }} transition={{ duration: 0.35, ease: EASE }} style={{ originX: `${C}px`, originY: `${C}px` }}>
          <text x={C} y={C - 34} textAnchor="middle" className="font-mono" fontSize={11} fill="white" fillOpacity={0.55} letterSpacing="0.2em">
            {center.top}
          </text>
          <text x={C} y={C + 14} textAnchor="middle" className="font-display" fontSize={50} fill="white">
            {center.big}
          </text>
          <text x={C} y={C + 40} textAnchor="middle" className="font-mono" fontSize={10} fill="white" fillOpacity={0.45}>
            {center.sub}
          </text>
        </motion.g>
      </AnimatePresence>

      {/* legend */}
      <g className="font-mono" fontSize={10}>
        <rect x={16} y={606} width={10} height={3} fill="rgb(255,199,0)" />
        <text x={32} y={610} fill="white" fillOpacity={0.6}>JEV dağılımı</text>
        <rect x={120} y={606} width={10} height={3} fill="rgb(64,214,196)" />
        <text x={136} y={610} fill="white" fillOpacity={0.6}>LAYA dağılımı</text>
        <text x={624} y={610} textAnchor="end" fill="white" fillOpacity={0.4}>kalınlık = olasılık kütlesi</text>
      </g>
    </svg>
  );
}
