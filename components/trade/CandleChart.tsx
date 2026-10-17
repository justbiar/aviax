"use client";

import { createChart, CrosshairMode, type IChartApi, type ISeriesApi, type UTCTimestamp, type IPriceLine } from "lightweight-charts";
import { useEffect, useRef, useState } from "react";

const BARS = ["1m", "5m", "15m", "1H", "4H", "1D"];

export type Overlay = { price: number; color: string; title: string; dashed?: boolean };

export function CandleChart({ instId, overlays = [], height = 420, dark = false }: { instId: string; overlays?: Overlay[]; height?: number; dark?: boolean }) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<IChartApi | null>(null);
  const series = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const vol = useRef<ISeriesApi<"Histogram"> | null>(null);
  const lines = useRef<IPriceLine[]>([]);
  const [bar, setBar] = useState("15m");

  useEffect(() => {
    if (!el.current) return;
    const fg = dark ? "rgba(255,255,255,0.55)" : "rgba(20,20,16,0.55)";
    const grid = dark ? "rgba(255,255,255,0.05)" : "rgba(20,20,16,0.05)";
    const c = createChart(el.current, {
      autoSize: true,
      layout: { background: { color: "transparent" }, textColor: fg, fontFamily: "var(--font-mono)", fontSize: 11 },
      grid: { vertLines: { color: grid }, horzLines: { color: grid } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderVisible: false },
      timeScale: { borderVisible: false, timeVisible: true, secondsVisible: false },
    });
    series.current = c.addCandlestickSeries({
      upColor: "rgb(0,168,107)",
      downColor: "rgb(232,65,66)",
      borderVisible: false,
      wickUpColor: "rgb(0,168,107)",
      wickDownColor: "rgb(232,65,66)",
    });
    vol.current = c.addHistogramSeries({ priceScaleId: "vol", priceFormat: { type: "volume" } });
    c.priceScale("vol").applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });
    chart.current = c;
    return () => {
      c.remove();
      chart.current = null;
    };
  }, [dark]);

  useEffect(() => {
    let alive = true;
    let first = true;
    let lastTime = 0;
    const load = async () => {
      const r = await fetch(`/api/market?kind=candles&instId=${instId}&bar=${bar}&limit=300`, { cache: "no-store" });
      const rows: string[][] = await r.json();
      if (!alive || !Array.isArray(rows) || !series.current) return;
      const data = rows
        .map((k) => ({ time: (Number(k[0]) / 1000) as UTCTimestamp, open: +k[1], high: +k[2], low: +k[3], close: +k[4], v: +k[5] }))
        .sort((a, b) => a.time - b.time);
      if (first) {
        series.current.setData(data);
        vol.current?.setData(data.map((d) => ({ time: d.time, value: d.v, color: d.close >= d.open ? "rgba(0,168,107,0.35)" : "rgba(232,65,66,0.35)" })));
        const px = data[data.length - 1]?.close ?? 1;
        const prec = px >= 1000 ? 1 : px >= 1 ? 3 : 6;
        series.current.applyOptions({ priceFormat: { type: "price", precision: prec, minMove: 1 / 10 ** prec } });
        chart.current?.timeScale().fitContent();
        first = false;
      } else {
        for (const d of data.slice(-2).filter((d) => d.time >= lastTime)) {
          series.current.update(d);
          vol.current?.update({ time: d.time, value: d.v, color: d.close >= d.open ? "rgba(0,168,107,0.35)" : "rgba(232,65,66,0.35)" });
        }
      }
      lastTime = data[data.length - 1]?.time ?? lastTime;
    };
    load();
    const id = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [instId, bar]);

  useEffect(() => {
    const s = series.current;
    if (!s) return;
    lines.current.forEach((l) => s.removePriceLine(l));
    lines.current = overlays.map((o) => s.createPriceLine({ price: o.price, color: o.color, lineWidth: 2, lineStyle: o.dashed ? 2 : 0, axisLabelVisible: true, title: o.title }));
  }, [overlays]);

  return (
    <div className="flex h-full flex-col">
      <div className="flex gap-1 px-3 pt-3" role="tablist" aria-label="Zaman aralığı">
        {BARS.map((b) => (
          <button
            key={b}
            role="tab"
            aria-selected={bar === b}
            onClick={() => setBar(b)}
            className={`rounded-md px-2 py-1 font-mono text-xs font-semibold transition-colors ${bar === b ? (dark ? "bg-white text-black" : "bg-ink text-paper") : dark ? "text-white/50 hover:text-white" : "text-ink/50 hover:text-ink"}`}
          >
            {b}
          </button>
        ))}
      </div>
      <div ref={el} style={{ height }} className="w-full" />
    </div>
  );
}
