"use client";

import { useEffect, useMemo, useState } from "react";
import { CandleChart, type Overlay } from "@/components/trade/CandleChart";
import { OrderBook, RecentTrades } from "@/components/trade/OrderBook";
import { OrderForm } from "@/components/trade/OrderForm";
import { AccountPanel, type Account } from "@/components/trade/AccountPanel";
import { CompanyActivity } from "@/components/company/CompanyActivity";
import { usePoll } from "@/lib/usePoll";
import { fmtCompact, fmtPct, fmtPx, short } from "@/lib/fmt";

type Ticker = { instId: string; last: string; open24h: string; high24h: string; low24h: string; volCcy24h: string };

const card = "rounded-card border border-ink/15 bg-paper shadow-card";

export default function TradePage() {
  const [instId, setInstId] = useState("BTC-USDT");
  const [bookTab, setBookTab] = useState<"book" | "trades">("book");
  const [pickedPx, setPickedPx] = useState<string>();
  const [query, setQuery] = useState("");
  const [publicSite, setPublicSite] = useState(false);
  const { data: tickers } = usePoll<Ticker[]>("/api/market?kind=tickers", 5000);
  const { data: acct, reload } = usePoll<Account>("/api/account", 4000);
  useEffect(() => setPublicSite(!/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)), []);

  const list = useMemo(
    () =>
      (tickers ?? [])
        .filter((t) => t.instId.endsWith("-USDT"))
        .map((t) => ({ ...t, qv: Number(t.volCcy24h), chg: (Number(t.last) / Number(t.open24h) - 1) * 100 }))
        .sort((a, b) => b.qv - a.qv)
        .slice(0, 40),
    [tickers],
  );
  const t = list.find((x) => x.instId === instId);
  const last = Number(t?.last ?? 0);

  const overlays: Overlay[] = useMemo(() => {
    const o: Overlay[] = [];
    acct?.algos?.filter((a) => a.instId === instId).forEach((a) => {
      if (a.tpTriggerPx) o.push({ price: Number(a.tpTriggerPx), color: "rgb(0,168,107)", title: "TP", dashed: true });
      if (a.slTriggerPx) o.push({ price: Number(a.slTriggerPx), color: "rgb(232,65,66)", title: "SL", dashed: true });
    });
    return o;
  }, [acct, instId]);

  return (
    <main className="paper-grid min-h-[calc(100vh-64px)]">
      <div className="mx-auto grid max-w-[1440px] gap-3 p-3 sm:p-4 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        {/* market list */}
        <aside className={`${card} hidden overflow-hidden lg:block`}>
          <div className="p-3">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Ara..." aria-label="Parite ara" className="w-full rounded-btn border border-ink/15 px-3 py-2 text-sm outline-none focus:border-ink" />
          </div>
          <div className="max-h-[calc(100vh-150px)] overflow-y-auto scroll-thin">
            {list
              .filter((x) => x.instId.toLowerCase().includes(query.toLowerCase()))
              .map((x) => (
                <button key={x.instId} onClick={() => setInstId(x.instId)} className={`grid w-full grid-cols-[1fr_auto] gap-x-2 px-3 py-2 text-left transition-colors ${x.instId === instId ? "bg-sun/30" : "hover:bg-ink/5"}`}>
                  <span className="text-sm font-bold">{short(x.instId)}<span className="font-normal text-muted">/USDT</span></span>
                  <span className="text-right font-mono text-xs num">{fmtPx(x.last)}</span>
                  <span className="font-mono text-[10px] text-muted">{fmtCompact(x.qv)}</span>
                  <span className={`text-right font-mono text-[10px] num ${x.chg >= 0 ? "text-long" : "text-short"}`}>{fmtPct(x.chg)}</span>
                </button>
              ))}
          </div>
        </aside>

        {/* chart + account */}
        <section className="min-w-0 space-y-3">
          <div className={`${card} flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3`}>
            <select value={instId} onChange={(e) => setInstId(e.target.value)} className="rounded-btn border border-ink/15 bg-paper px-2 py-1.5 font-display text-2xl tracking-wide lg:hidden" aria-label="Parite">
              {list.map((x) => <option key={x.instId} value={x.instId}>{short(x.instId)}</option>)}
            </select>
            <h1 className="hidden font-display text-3xl tracking-wide lg:block">{short(instId)}<span className="text-ink/30">-USDT</span> <span className="align-middle font-sans text-xs font-bold text-muted">SPOT</span></h1>
            <Stat label="Son" value={fmtPx(last)} big tone={t && t.chg >= 0 ? "up" : "down"} />
            <Stat label="24s değişim" value={t ? fmtPct(t.chg) : "-"} tone={t && t.chg >= 0 ? "up" : "down"} />
            <Stat label="24s yüksek" value={fmtPx(t?.high24h)} />
            <Stat label="24s düşük" value={fmtPx(t?.low24h)} />
            <Stat label="24s hacim" value={t ? `${fmtCompact(t.qv)} USDT` : "-"} />
          </div>
          <div className={`${card} overflow-hidden`}>
            <CandleChart instId={instId} overlays={overlays} height={440} />
          </div>
          {publicSite ? <CompanyActivity /> : <div className={`${card} overflow-hidden`}><AccountPanel acct={acct} reload={reload} /></div>}
        </section>

        {/* book + form */}
        <aside className="space-y-3">
          {publicSite ? <div className={`${card} p-4`}><p className="font-mono text-xs uppercase tracking-wider text-muted">Şirket hesabı · salt okunur</p><p className="mt-2 text-sm text-ink/65">Bu panel şirket portföyündeki varlık ve emir geçmişini gösterir. Şirket OKX bağlantısından emir göndermez.</p></div> : <div className={`${card} overflow-hidden`}><OrderForm instId={instId} last={last} presetPx={pickedPx} onPlaced={reload} /></div>}
          <div className={`${card} overflow-hidden pb-2`}>
            <div className="flex gap-1 p-2">
              {(["book", "trades"] as const).map((b) => (
                <button key={b} onClick={() => setBookTab(b)} className={`flex-1 rounded-[8px] py-1.5 text-xs font-bold ${bookTab === b ? "bg-ink text-paper" : "text-ink/50 hover:bg-ink/5"}`}>
                  {b === "book" ? "Emir defteri" : "Son işlemler"}
                </button>
              ))}
            </div>
            {bookTab === "book" ? <OrderBook instId={instId} onPick={setPickedPx} /> : <RecentTrades instId={instId} />}
          </div>
        </aside>
      </div>
    </main>
  );
}

function Stat({ label, value, big, tone }: { label: string; value: string; big?: boolean; tone?: "up" | "down" }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{label}</div>
      <div className={`font-mono num ${big ? "text-lg font-bold" : "text-sm"} ${tone === "up" ? "text-long" : tone === "down" ? "text-short" : ""}`}>{value}</div>
    </div>
  );
}
