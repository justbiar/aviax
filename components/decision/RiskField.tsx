"use client";

import { motion } from "framer-motion";
import type { RiskEvent } from "@/lib/riskDesk";

/**
 * Risk probability field, same visual grammar as the agent's DecisionField.
 * Every holding owns a sector on the outer ring sized by its portfolio weight.
 * Filaments stream from the core to each sector: amber = primary model, teal = second
 * opinion; thickness = weight x that model's probability that the company must intervene.
 * The inner ring is the risk-level distribution, the core is the joint verdict.
 */

const C = 320;
const R_OUT = 268;
const R_LVL = 128;
const R_CORE = 104;
const FILAMENTS = 15;
const EASE = [0.22, 1, 0.36, 1] as const;
const AMBER = "rgb(255,199,0)";
const TEAL = "rgb(64,214,196)";
const LVL: Record<string, string> = { low: "rgb(0,200,120)", elevated: "rgb(253,186,116)", critical: "rgb(255,80,80)" };
const NICE: Record<string, string> = { yes: "MÜDAHALE", no: "KORU", uncertain: "KARARSIZ", low: "düşük", elevated: "yükselmiş", critical: "kritik" };

const r2 = (v: number) => Math.round(v * 100) / 100;
const polar = (r: number, a: number) => [r2(C + r * Math.cos(a)), r2(C + r * Math.sin(a))] as const;
function arc(r: number, a0: number, a1: number) {
  const [x0, y0] = polar(r, a0);
  const [x1, y1] = polar(r, a1);
  return `M ${x0} ${y0} A ${r} ${r} 0 ${a1 - a0 > Math.PI ? 1 : 0} 1 ${x1} ${y1}`;
}
function spiral(target: number, offset: number, twist: number) {
  const a = target + offset;
  const [sx, sy] = polar(R_CORE + 14, a - twist * 1.15);
  const [c1x, c1y] = polar(R_LVL + 70, a - twist * 0.85);
  const [c2x, c2y] = polar(R_OUT - 70, a - twist * 0.25);
  const [ex, ey] = polar(R_OUT - 14, a);
  return `M ${sx} ${sy} C ${c1x} ${c1y}, ${c2x} ${c2y}, ${ex} ${ey}`;
}

type Ev<T extends RiskEvent["type"]> = Extract<RiskEvent, { type: T }>;

export function RiskField({ portfolio, checks, models, decision, busy }: { portfolio?: Ev<"portfolio">; checks?: Ev<"checks">; models?: Ev<"models">; decision?: Ev<"decision">; busy: boolean }) {
  const holdings = portfolio?.holdings ?? [];
  const minSpan = 0.18;
  const free = Math.PI * 2 - Math.max(holdings.length, 1) * 0.04;
  // Sector spans follow weight, with a floor so small holdings stay visible.
  const raw = holdings.map((h) => Math.max(minSpan, (h.weight / 100) * free));
  const scale = raw.length ? free / raw.reduce((a, b) => a + b, 0) : 1;
  let cursor = -Math.PI / 2;
  const sectors = holdings.map((h, i) => {
    const span = raw[i] * scale;
    const a0 = cursor + 0.02;
    const a1 = cursor + span - 0.02;
    cursor += span + 0.04;
    return { h, a0, a1, mid: (a0 + a1) / 2, span };
  });
  const verdict = models?.answers.verdict;
  const pY = verdict?.primary.yes ?? 0;
  const sY = verdict?.second?.yes ?? pY;
  const level = models?.answers.risk_level;
  const top = holdings.find((h) => !h.reserve);
  const breachW = checks?.checks.find((c) => c.key === "weight")?.status === "breach";
  const rec = decision?.record;

  const center = rec
    ? { top: NICE[rec.verdict] ?? rec.verdict, big: `${Math.round(rec.verdictConfidence * 100)}%`, sub: "ortak karar" }
    : busy
      ? { top: models ? "KARAR" : checks ? "MODELLER" : portfolio ? "LİMİTLER" : "OKX", big: `${holdings.length || "-"}`, sub: "varlık" }
      : { top: "IDLE", big: "p(·)", sub: "dağılım bekleniyor" };

  // Risk-level ring: arcs proportional to the ensemble distribution.
  let la = -Math.PI / 2;
  const lvlArcs = level ? level.labels.map((l) => { const v = level.ensemble[l] ?? 0; const a0 = la; la += v * Math.PI * 2; return { l, a0, a1: la, v }; }) : [];

  return (
    <svg viewBox="0 0 640 640" className="h-full w-full" role="img" aria-label="Risk masasının olasılık alanı">
      <defs>
        <radialGradient id="rcore" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor={AMBER} stopOpacity="0.35" />
          <stop offset="60%" stopColor={AMBER} stopOpacity="0.05" />
          <stop offset="100%" stopColor={AMBER} stopOpacity="0" />
        </radialGradient>
        <filter id="rglow" x="-50%" y="-50%" width="200%" height="200%">
          <feGaussianBlur stdDeviation="3" result="b" />
          <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>

      {[R_OUT, 210, 160, R_LVL, R_CORE].map((r) => <circle key={r} cx={C} cy={C} r={r} fill="none" stroke="white" strokeOpacity={0.05} />)}
      <circle cx={C} cy={C} r={R_CORE - 6} fill="url(#rcore)" />

      <motion.g style={{ originX: `${C}px`, originY: `${C}px` }} animate={{ rotate: busy ? 360 : 0 }} transition={{ duration: 24, repeat: busy ? Infinity : 0, ease: "linear" }}>
        {Array.from({ length: 120 }, (_, i) => {
          const a = (i / 120) * Math.PI * 2;
          const [x0, y0] = polar(R_OUT + 10, a);
          const [x1, y1] = polar(R_OUT + (i % 10 === 0 ? 20 : 15), a);
          return <line key={i} x1={x0} y1={y0} x2={x1} y2={y1} stroke="white" strokeOpacity={i % 10 === 0 ? 0.35 : 0.12} />;
        })}
      </motion.g>

      {/* filaments */}
      {sectors.map(({ h, mid, span }) => {
        const hot = h.ccy === top?.ccy && breachW;
        const n = h.reserve ? 5 : FILAMENTS;
        return (
          <g key={h.ccy}>
            {Array.from({ length: n }, (_, k) => {
              const t = n > 1 ? k / (n - 1) - 0.5 : 0;
              const off = t * span * 0.62;
              const isP = k % 2 === 0;
              const prob = models ? (isP ? pY : sY) : 0.3;
              const w = h.weight / 100;
              const width = h.reserve ? 0.6 : 0.6 + prob * (0.6 + w * 9) * (1 - Math.abs(t) * 1.2);
              const color = h.reserve ? "rgb(255,255,255)" : isP ? AMBER : TEAL;
              const op = h.reserve ? 0.12 : !models ? 0.15 : hot ? 0.95 : 0.2 + prob * w * 1.6;
              return (
                <motion.path key={k} d={spiral(mid, off, 0.9 + k * 0.025)} fill="none" stroke={color} strokeLinecap="round"
                  initial={{ pathLength: 0, opacity: 0 }} animate={{ pathLength: 1, opacity: Math.min(1, op), strokeWidth: Math.max(0.5, width) }}
                  transition={{ duration: 1.1, delay: k * 0.03, ease: EASE }} filter={hot ? "url(#rglow)" : undefined} />
              );
            })}
            {busy && !models && !h.reserve && <path d={spiral(mid, 0, 1.06)} fill="none" stroke="white" strokeOpacity={0.5} strokeWidth={1.2} className="flow" />}
          </g>
        );
      })}

      {/* outer sectors + labels */}
      {sectors.map(({ h, a0, a1, mid }) => {
        const hot = h.ccy === top?.ccy && breachW;
        const [lx, ly] = polar(R_OUT + 40, mid);
        return (
          <g key={`s-${h.ccy}`}>
            <path d={arc(R_OUT, a0, a1)} fill="none" stroke={h.reserve ? "rgba(255,255,255,0.35)" : hot ? "rgb(255,80,80)" : AMBER} strokeWidth={hot ? 12 : 8} strokeLinecap="round" opacity={h.reserve ? 0.6 : 1} filter={hot ? "url(#rglow)" : undefined} />
            <text x={lx} y={ly - 4} textAnchor="middle" className="font-display" fill="white" style={{ fontSize: 16 }}>{h.ccy}</text>
            <text x={lx} y={ly + 11} textAnchor="middle" className="font-mono" fill={hot ? "rgb(255,120,120)" : "rgba(255,255,255,0.55)"} style={{ fontSize: 10 }}>%{h.weight.toFixed(1)}{h.reserve ? " rezerv" : ""}</text>
          </g>
        );
      })}

      {/* risk-level ring */}
      {lvlArcs.map(({ l, a0, a1, v }) => v > 0.005 && (
        <motion.path key={l} d={arc(R_LVL, a0, Math.max(a0 + 0.01, a1 - 0.02))} fill="none" stroke={LVL[l] ?? "white"} strokeWidth={10} strokeLinecap="round" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, ease: EASE }} opacity={l === level?.pick ? 1 : 0.45} />
      ))}
      {level && (() => {
        const p = lvlArcs.find((x) => x.l === level.pick);
        if (!p) return null;
        const [x, y] = polar(R_LVL + 24, (p.a0 + p.a1) / 2);
        return <text x={x} y={y} textAnchor="middle" className="font-mono" fill={LVL[level.pick]} style={{ fontSize: 10 }}>{NICE[level.pick]} %{Math.round(p.v * 100)}</text>;
      })()}

      {/* core */}
      <text x={C} y={C - 14} textAnchor="middle" className="font-display" fill={rec?.verdict === "yes" ? AMBER : rec?.verdict === "no" ? TEAL : "white"} style={{ fontSize: 26 }}>{center.top}</text>
      <text x={C} y={C + 20} textAnchor="middle" className="font-display" fill="white" style={{ fontSize: 34 }}>{center.big}</text>
      <text x={C} y={C + 40} textAnchor="middle" className="font-mono" fill="rgba(255,255,255,0.5)" style={{ fontSize: 11 }}>{center.sub}</text>
    </svg>
  );
}
