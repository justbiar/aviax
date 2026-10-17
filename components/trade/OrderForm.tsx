"use client";

import { useEffect, useState } from "react";
import { fmtPx } from "@/lib/fmt";

export function OrderForm({ instId, last, presetPx, onPlaced }: { instId: string; last: number; presetPx?: string; onPlaced: () => void }) {
  const [ordType, setOrdType] = useState<"market" | "limit">("market");
  const [px, setPx] = useState("");
  const [notional, setNotional] = useState(100);
  const [lever, setLever] = useState(3);
  const [useTpSl, setUseTpSl] = useState(false);
  const [tp, setTp] = useState("");
  const [sl, setSl] = useState("");
  const [busy, setBusy] = useState<"buy" | "sell" | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (presetPx) {
      setOrdType("limit");
      setPx(presetPx);
    }
  }, [presetPx]);
  useEffect(() => {
    setPx("");
    setTp("");
    setSl("");
  }, [instId]);

  const submit = async (side: "buy" | "sell") => {
    setBusy(side);
    setMsg(null);
    try {
      const r = await fetch("/api/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "place", instId, side, ordType, px: px || undefined, notional, lever, tp: useTpSl ? tp : undefined, sl: useTpSl ? sl : undefined }),
      });
      const j = await r.json();
      if (!j.ok) throw new Error(j.error);
      setMsg({ ok: true, text: `${side === "buy" ? "Long" : "Short"} gönderildi · ${j.sz} kontrat` });
      onPlaced();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  const field = "w-full rounded-btn border border-ink/20 bg-paper px-3 py-2.5 font-mono text-sm num outline-none transition-shadow focus:border-ink focus:shadow-[0_0_0_3px_rgb(var(--sun)/0.5)]";

  return (
    <div className="space-y-4 p-4">
      <div className="grid grid-cols-2 gap-1 rounded-btn bg-ink/5 p-1" role="tablist">
        {(["market", "limit"] as const).map((t) => (
          <button key={t} role="tab" aria-selected={ordType === t} onClick={() => setOrdType(t)} className={`rounded-[8px] py-2 text-sm font-bold capitalize transition-all ${ordType === t ? "bg-paper shadow-btn" : "text-ink/50"}`}>
            {t === "market" ? "Piyasa" : "Limit"}
          </button>
        ))}
      </div>

      {ordType === "limit" && (
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-muted">Fiyat (USDT)</span>
          <input className={field} inputMode="decimal" value={px} placeholder={fmtPx(last)} onChange={(e) => setPx(e.target.value)} />
        </label>
      )}

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold text-muted">
          <span>Tutar (USDT notional)</span>
          <span className="font-mono text-ink num">{notional}</span>
        </span>
        <input className={field} inputMode="decimal" value={notional} onChange={(e) => setNotional(Number(e.target.value) || 0)} />
        <div className="mt-2 flex gap-1">
          {[50, 100, 250, 500, 1000].map((v) => (
            <button key={v} onClick={() => setNotional(v)} className="flex-1 rounded-md border border-ink/15 py-1 font-mono text-[11px] hover:border-ink">
              {v}
            </button>
          ))}
        </div>
      </label>

      <label className="block">
        <span className="mb-1 flex justify-between text-xs font-semibold text-muted">
          <span>Kaldıraç</span>
          <span className="font-mono text-ink">{lever}x</span>
        </span>
        <input type="range" min={1} max={20} value={lever} onChange={(e) => setLever(Number(e.target.value))} className="w-full accent-[rgb(var(--ink))]" />
      </label>

      <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
        <input type="checkbox" checked={useTpSl} onChange={(e) => setUseTpSl(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--ink))]" />
        TP / SL ekle
      </label>
      {useTpSl && (
        <div className="grid grid-cols-2 gap-2">
          <input className={field} placeholder="TP tetik" value={tp} onChange={(e) => setTp(e.target.value)} aria-label="Take profit" />
          <input className={field} placeholder="SL tetik" value={sl} onChange={(e) => setSl(e.target.value)} aria-label="Stop loss" />
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 pt-1">
        <button
          disabled={!!busy}
          onClick={() => submit("buy")}
          className="min-h-[48px] rounded-btn border border-ink/10 bg-long font-bold text-white shadow-btn transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {busy === "buy" ? "..." : "Long / Al"}
        </button>
        <button
          disabled={!!busy}
          onClick={() => submit("sell")}
          className="min-h-[48px] rounded-btn border border-ink/10 bg-short font-bold text-white shadow-btn transition-transform active:scale-[0.98] disabled:opacity-60"
        >
          {busy === "sell" ? "..." : "Short / Sat"}
        </button>
      </div>
      {msg && <p className={`rounded-btn px-3 py-2 text-xs font-medium ${msg.ok ? "bg-long/10 text-long" : "bg-short/10 text-short"}`}>{msg.text}</p>}
      <p className="text-[11px] leading-relaxed text-muted">Emirler OKX demo hesabına gider (x-simulated-trading). Cross margin, piyasa emrinde son fiyattan kontrata çevrilir.</p>
    </div>
  );
}
