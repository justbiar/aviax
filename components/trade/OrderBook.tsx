"use client";

import { fmtPx, fmtNum } from "@/lib/fmt";
import { usePoll } from "@/lib/usePoll";

type Book = { asks: string[][]; bids: string[][] };
type Trade = { px: string; sz: string; side: "buy" | "sell"; ts: string; tradeId: string };

export function OrderBook({ instId, onPick }: { instId: string; onPick?: (px: string) => void }) {
  const { data } = usePoll<Book>(`/api/market?kind=book&instId=${instId}`, 1500);
  const asks = (data?.asks ?? []).slice(0, 10).reverse();
  const bids = (data?.bids ?? []).slice(0, 10);
  const max = Math.max(1, ...[...asks, ...bids].map((r) => Number(r[1])));
  const spread = data?.asks?.[0] && data?.bids?.[0] ? Number(data.asks[0][0]) - Number(data.bids[0][0]) : 0;

  const Row = ({ r, side }: { r: string[]; side: "ask" | "bid" }) => (
    <button
      onClick={() => onPick?.(r[0])}
      className="relative grid w-full grid-cols-2 px-3 py-[3px] text-left font-mono text-xs num hover:bg-ink/5"
    >
      <span
        className={`absolute inset-y-0 right-0 ${side === "ask" ? "bg-short/10" : "bg-long/10"}`}
        style={{ width: `${(Number(r[1]) / max) * 100}%` }}
        aria-hidden
      />
      <span className={`relative ${side === "ask" ? "text-short" : "text-long"}`}>{fmtPx(r[0])}</span>
      <span className="relative text-right text-ink/70">{fmtNum(r[1], 2)}</span>
    </button>
  );

  return (
    <div>
      <div className="grid grid-cols-2 px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Fiyat</span>
        <span className="text-right">Miktar (ct)</span>
      </div>
      {asks.map((r) => <Row key={"a" + r[0]} r={r} side="ask" />)}
      <div className="my-1 border-y border-ink/10 px-3 py-1.5 font-mono text-xs text-muted num">spread {fmtPx(spread)}</div>
      {bids.map((r) => <Row key={"b" + r[0]} r={r} side="bid" />)}
    </div>
  );
}

export function RecentTrades({ instId }: { instId: string }) {
  const { data } = usePoll<Trade[]>(`/api/market?kind=trades&instId=${instId}`, 2000);
  return (
    <div>
      <div className="grid grid-cols-3 px-3 pb-1 font-mono text-[10px] uppercase tracking-wider text-muted">
        <span>Fiyat</span>
        <span className="text-right">Miktar</span>
        <span className="text-right">Saat</span>
      </div>
      {(data ?? []).slice(0, 18).map((t) => (
        <div key={t.tradeId} className="grid grid-cols-3 px-3 py-[3px] font-mono text-xs num">
          <span className={t.side === "buy" ? "text-long" : "text-short"}>{fmtPx(t.px)}</span>
          <span className="text-right text-ink/70">{fmtNum(t.sz, 2)}</span>
          <span className="text-right text-muted">{new Date(Number(t.ts)).toLocaleTimeString("tr-TR")}</span>
        </div>
      ))}
    </div>
  );
}
