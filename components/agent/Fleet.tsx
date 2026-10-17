"use client";

import { motion, AnimatePresence } from "framer-motion";
import { useEffect, useState } from "react";
import { MODEL_OPTIONS, modelLabel } from "@/lib/models";
import { fmtNum, fmtPx, short } from "@/lib/fmt";

export type FleetTrade = { instId: string; side: "long"; qty?: string; entry: number; exit?: number; tp: number; sl: number; notional: number; leverage: number; margin: number; pnl?: number; reason?: string; openedAt: number; closedAt?: number };
export type FleetAgentView = {
  id: string;
  name: string;
  model: string;
  execution: "paper" | "okx";
  budget: number;
  intervalSec: number;
  maxLeverage: number;
  universe: number;
  status: "running" | "paused";
  phase: "idle" | "thinking" | "in_position" | "cooldown" | "error";
  position: FleetTrade | null;
  trades: FleetTrade[];
  realizedPnl: number;
  equity: number;
  upl: number;
  runs: number;
  nextRunAt: number;
  lastError: string | null;
  lastVerdict: string | null;
  busy: boolean;
};

const EASE = [0.22, 1, 0.36, 1] as const;
const field = "w-full rounded-btn border border-ink/20 bg-paper px-3 py-2.5 text-sm outline-none transition-shadow focus:border-ink focus:shadow-[0_0_0_3px_rgb(var(--sun)/0.5)]";
const label = "mb-1 block text-xs font-semibold text-muted";

export function AgentForm({ onCreated }: { onCreated: (id: string) => void }) {
  const [name, setName] = useState("");
  const [model, setModel] = useState(MODEL_OPTIONS[0].value);
  const [budget, setBudget] = useState(200);
  const [execution, setExecution] = useState<"paper" | "okx">("paper");
  const [intervalSec, setIntervalSec] = useState(300);
  const [universe, setUniverse] = useState(6);
  const [maxHoldMin, setMaxHoldMin] = useState(240);
  const [adv, setAdv] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const groups = [...new Set(MODEL_OPTIONS.map((m) => m.group))];
  const note = MODEL_OPTIONS.find((m) => m.value === model)?.note;

  const submit = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name || `Ajan ${Math.floor(Math.random() * 90 + 10)}`, model, execution, budget, intervalSec, maxLeverage: 1, universe, maxHoldMin }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setName("");
      onCreated(j.id);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-ink/50 bg-paper p-4 text-left shadow-card">
      <div className="grid gap-3 sm:grid-cols-[1fr_1.4fr_1fr]">
        <label>
          <span className={label}>Ajan adı</span>
          <input className={field} value={name} placeholder="ör. Atlas" onChange={(e) => setName(e.target.value)} maxLength={24} />
        </label>
        <label>
          <span className={label}>Karar modeli</span>
          <select className={field} value={model} onChange={(e) => setModel(e.target.value)}>
            {groups.map((g) => (
              <optgroup key={g} label={g}>
                {MODEL_OPTIONS.filter((m) => m.group === g).map((m) => (
                  <option key={m.value} value={m.value}>{m.label}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>
        <label>
          <span className={label}>Bütçe (USDT)</span>
          <input className={`${field} font-mono`} inputMode="decimal" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        {[50, 100, 250, 500, 1000].map((v) => (
          <button key={v} onClick={() => setBudget(v)} className={`rounded-md border px-2.5 py-1 font-mono text-xs transition-colors ${budget === v ? "border-ink bg-ink text-paper" : "border-ink/15 hover:border-ink"}`}>
            {v}
          </button>
        ))}
        <span className="ml-1 text-xs text-muted">{note}</span>
      </div>

      <AnimatePresence initial={false}>
        {adv && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.3, ease: EASE }} className="overflow-hidden">
            <div className="mt-4 grid gap-3 border-t border-ink/10 pt-4 sm:grid-cols-4">
              <label>
                <span className={label}>Yürütme</span>
                <select className={field} value={execution} onChange={(e) => setExecution(e.target.value as "paper" | "okx")}>
                  <option value="paper">Paper (canlı fiyat)</option>
                  <option value="okx">OKX demo emri</option>
                </select>
              </label>
              <label>
                <span className={label}>Tur aralığı</span>
                <select className={field} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}>
                  <option value={60}>1 dakika</option>
                  <option value={300}>5 dakika</option>
                  <option value={900}>15 dakika</option>
                  <option value={3600}>1 saat</option>
                </select>
              </label>
              <label>
                <span className={label}>Taranan parite</span>
                <select className={field} value={universe} onChange={(e) => setUniverse(Number(e.target.value))}>
                  {[4, 6, 8].map((v) => <option key={v} value={v}>En likit {v}</option>)}
                </select>
              </label>
              <label>
                <span className={label}>Maks. pozisyon süresi</span>
                <select className={field} value={maxHoldMin} onChange={(e) => setMaxHoldMin(Number(e.target.value))}>
                  <option value={30}>30 dakika</option>
                  <option value={120}>2 saat</option>
                  <option value={240}>4 saat</option>
                  <option value={720}>12 saat</option>
                </select>
              </label>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button onClick={() => setAdv((a) => !a)} className="text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">
          {adv ? "Ayarları gizle" : "Ayarlar"}
        </button>
        {err && <span className="text-sm text-short">{err}</span>}
        <button onClick={submit} disabled={busy} className="ml-auto min-h-[44px] rounded-btn border border-ink/10 bg-sun px-5 font-bold shadow-btn transition-transform hover:-translate-y-px active:translate-y-0 disabled:opacity-60">
          {busy ? "Oluşturuluyor..." : "Ajanı başlat →"}
        </button>
      </div>
    </div>
  );
}

const PHASE: Record<FleetAgentView["phase"], { t: string; c: string }> = {
  idle: { t: "Hazır", c: "bg-ink/10 text-ink/60" },
  thinking: { t: "Karar veriyor", c: "bg-sun text-ink" },
  in_position: { t: "Pozisyonda", c: "bg-long/15 text-long" },
  cooldown: { t: "Bekliyor", c: "bg-ink/10 text-ink/60" },
  error: { t: "Hata", c: "bg-short/15 text-short" },
};

function Countdown({ at }: { at: number }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const s = Math.max(0, Math.round((at - now) / 1000));
  return <>{s > 0 ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}` : "şimdi"}</>;
}

export function AgentCard({ a, selected, onSelect }: { a: FleetAgentView; selected: boolean; onSelect: () => void }) {
  const act = (action: string) => fetch(`/api/fleet/${a.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
  const pnl = a.equity - a.budget;
  const pnlPct = (pnl / a.budget) * 100;
  const marginUsed = a.position ? a.position.margin : 0;
  const ph = a.status === "paused" ? { t: "Durduruldu", c: "bg-ink/10 text-ink/50" } : PHASE[a.phase];
  const wins = a.trades.filter((t) => (t.pnl ?? 0) > 0).length;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.97 }}
      transition={{ duration: 0.4, ease: EASE }}
      className={`flex flex-col rounded-card border bg-paper p-4 text-left shadow-card transition-colors ${selected ? "border-ink ring-2 ring-sun" : "border-ink/15"}`}
    >
      <div className="flex items-start justify-between gap-2">
        <button onClick={onSelect} className="min-w-0 text-left">
          <div className="truncate font-display text-2xl uppercase leading-none tracking-wide">{a.name}</div>
          <div className="mt-1 truncate font-mono text-[11px] text-muted">
            {modelLabel(a.model)} · {a.execution === "okx" ? "OKX demo" : "paper"}
          </div>
        </button>
        <span className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${ph.c}`}>
          {a.phase === "thinking" && a.status === "running" && <span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-ink align-middle" />}
          {ph.t}
        </span>
      </div>

      <div className="mt-4 flex items-end justify-between">
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Bakiye (USDT)</div>
          <div className="font-mono text-2xl font-bold num">{fmtNum(a.equity, 2)}</div>
        </div>
        <div className={`text-right font-mono text-sm font-bold num ${pnl >= 0 ? "text-long" : "text-short"}`}>
          {pnl >= 0 ? "+" : ""}
          {fmtNum(pnl, 2)} <span className="text-xs">({pnlPct >= 0 ? "+" : ""}{pnlPct.toFixed(2)}%)</span>
        </div>
      </div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-ink/10" aria-label="Kullanılan teminat">
        <motion.div className="h-full rounded-full bg-ink" animate={{ width: `${Math.min(100, (marginUsed / Math.max(1, a.budget)) * 100)}%` }} transition={{ duration: 0.6, ease: EASE }} />
      </div>
      <div className="mt-1 flex justify-between font-mono text-[10px] text-muted">
        <span>kullanılan {fmtNum(marginUsed, 0)} / {fmtNum(a.budget, 0)}</span>
        <span>{a.trades.length} işlem · {wins} kâr</span>
      </div>

      <div className="mt-3 min-h-[52px] break-words rounded-btn bg-ink/[0.04] px-3 py-2 font-mono text-xs [overflow-wrap:anywhere]">
        {a.position ? (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <b className="text-long">AL {short(a.position.instId)}</b>
            <span>{Number(a.position.qty ?? 0).toString()} adet</span>
            <span className="text-muted">giriş {fmtPx(a.position.entry)}</span>
            <span className="text-long">TP {fmtPx(a.position.tp)}</span>
            <span className="text-short">SL {fmtPx(a.position.sl)}</span>
            <b className={a.upl >= 0 ? "text-long" : "text-short"}>{a.upl >= 0 ? "+" : ""}{fmtNum(a.upl, 2)}</b>
          </div>
        ) : a.lastError ? (
          <span className="text-short">{a.lastError.slice(0, 140)}</span>
        ) : a.status === "running" && a.phase !== "thinking" ? (
          <span className="text-muted">Sonraki tur: <Countdown at={a.nextRunAt} /> {a.lastVerdict === "hold" && "· son tur: işlem yok"}</span>
        ) : (
          <span className="text-muted">{a.phase === "thinking" ? "Piyasayı tarıyor, dağılımlar hesaplanıyor..." : "Duraklatıldı"}</span>
        )}
      </div>

      {a.trades.length > 0 && (
        <div className="mt-2 space-y-0.5">
          {a.trades.slice(0, 3).map((t) => (
            <div key={t.openedAt} className="flex justify-between font-mono text-[11px]">
              <span className="text-muted">{short(t.instId)} · {t.reason?.toUpperCase()}</span>
              <span className={(t.pnl ?? 0) >= 0 ? "text-long" : "text-short"}>{(t.pnl ?? 0) >= 0 ? "+" : ""}{fmtNum(t.pnl ?? 0, 2)}</span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-auto flex flex-wrap gap-1.5 pt-4">
        <button onClick={onSelect} className={`min-h-[36px] rounded-btn px-3 text-xs font-bold ${selected ? "bg-ink text-paper" : "border border-ink/20 hover:border-ink"}`}>
          {selected ? "İzleniyor" : "İzle"}
        </button>
        {a.status === "running" ? (
          <button onClick={() => act("pause")} className="min-h-[36px] rounded-btn border border-ink/20 px-3 text-xs font-bold hover:border-ink">Duraklat</button>
        ) : (
          <button onClick={() => act("start")} className="min-h-[36px] rounded-btn border border-ink/20 px-3 text-xs font-bold hover:border-ink">Başlat</button>
        )}
        {!a.position && !a.busy && a.status === "running" && (
          <button onClick={() => act("run")} className="min-h-[36px] rounded-btn border border-ink/20 px-3 text-xs font-bold hover:border-ink">Şimdi tur at</button>
        )}
        {a.position && (
          <button onClick={() => act("close")} className="min-h-[36px] rounded-btn border border-ink/20 px-3 text-xs font-bold hover:border-ink">Pozisyonu kapat</button>
        )}
        <button
          onClick={() => confirm(`${a.name} silinsin mi? Açık pozisyonu varsa kapatılır.`) && act("delete")}
          className="ml-auto min-h-[36px] rounded-btn px-3 text-xs font-bold text-muted hover:text-short"
        >
          Sil
        </button>
      </div>
    </motion.div>
  );
}
