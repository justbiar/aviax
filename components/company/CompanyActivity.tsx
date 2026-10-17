"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

type CompanyActivityData = {
  connected: boolean;
  companyName?: string;
  balance?: { totalEq: string } | null;
  assets?: { ccy: string; eq: string; eqUsd?: string }[];
  orders?: { ordId: string; instId: string; side: string; ordType: string; px: string; sz: string; accFillSz: string; state: string; cTime: string; avgPx: string }[];
  history?: { ordId: string; instId: string; side: string; ordType: string; px: string; sz: string; accFillSz: string; state: string; cTime: string; avgPx: string }[];
  errors?: string[];
};

const money = (value: string | number) => Number(value).toLocaleString("tr-TR", { maximumFractionDigits: 2 });
const shortPair = (value: string) => value.replace(/-USDT$/, " / USDT");

export function CompanyActivity() {
  const [data, setData] = useState<CompanyActivityData | null>(null);
  useEffect(() => {
    let alive = true;
    const load = () => fetch("/api/company/activity", { cache: "no-store" }).then((response) => response.json()).then((result: CompanyActivityData) => { if (alive) setData(result); }).catch(() => undefined);
    void load();
    const timer = window.setInterval(load, 10_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, []);

  if (!data?.connected) return <section className="rounded-card border border-ink/15 bg-paper p-5 shadow-card"><p className="font-mono text-xs uppercase tracking-wider text-muted">Şirket portföyü · OKX demo</p><h2 className="mt-2 font-display text-2xl">ŞİRKET HESABI BEKLENİYOR</h2><p className="mt-2 text-sm text-muted">Trade ekranında şirket varlıklarını ve emir geçmişini görmek için şirketinin OKX demo hesabını bağla.</p><Link href="/company" className="mt-4 inline-flex rounded-btn border-2 border-ink bg-sun px-4 py-2.5 text-sm font-bold">Şirket hesabını bağla →</Link></section>;

  const assets = [...(data.assets ?? [])].sort((a, b) => Number(b.eqUsd ?? 0) - Number(a.eqUsd ?? 0));
  const orders = (data.history ?? []).slice(0, 12);
  const th = "px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-white/45";
  const td = "whitespace-nowrap px-3 py-2 font-mono text-xs";

  return <section className="overflow-hidden rounded-card border border-ink/15 bg-stage text-white shadow-card">
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-5">
      <div><p className="font-mono text-xs uppercase tracking-wider text-sun">Şirket portföyü · OKX demo</p><h2 className="mt-1 font-display text-2xl">{data.companyName ?? "ŞİRKET VARLIKLARI"}</h2><p className="mt-1 text-xs text-white/45">Şirket hesabındaki varlıklar, açık emirler ve son işlemler · salt okunur</p></div>
      <div className="rounded-btn border border-white/10 bg-black/25 px-4 py-2"><div className="text-[10px] uppercase tracking-wider text-white/45">Toplam portföy</div><b className="font-mono text-xl">${money(data.balance?.totalEq ?? 0)}</b></div>
    </div>
    <div className="grid gap-4 p-5 lg:grid-cols-[minmax(220px,.75fr)_minmax(0,1.25fr)]">
      <div><h3 className="mb-2 font-display text-lg">ŞİRKET VARLIKLARI</h3><div className="max-h-[280px] space-y-1.5 overflow-auto">{assets.length ? assets.map((asset) => <div key={asset.ccy} className="flex items-center justify-between gap-3 rounded-btn border border-white/5 bg-black/20 px-3 py-2"><span className="font-bold">{asset.ccy}</span><span className="text-right font-mono text-xs text-white/70">{money(asset.eq)}<span className="ml-2 text-white/40">${money(asset.eqUsd ?? 0)}</span></span></div>) : <p className="rounded-btn bg-black/20 p-3 text-sm text-white/45">Portföyde gösterilecek varlık yok.</p>}</div>
        {(data.orders?.length ?? 0) > 0 && <p className="mt-3 text-xs text-sun">{data.orders?.length} açık spot emir</p>}
      </div>
      <div className="min-w-0"><h3 className="mb-2 font-display text-lg">ŞİRKETİN SON İŞLEMLERİ</h3><div className="max-h-[280px] overflow-auto rounded-btn border border-white/10"><table className="w-full"><thead className="sticky top-0 bg-[#151515]"><tr><th className={th}>Zaman</th><th className={th}>Parite</th><th className={th}>Yön</th><th className={th}>Ort. fiyat</th><th className={th}>Miktar</th><th className={th}>Durum</th></tr></thead><tbody>{orders.map((order) => <tr key={order.ordId} className="border-t border-white/5"><td className={`${td} text-white/45`}>{order.cTime ? new Date(Number(order.cTime)).toLocaleString("tr-TR") : "-"}</td><td className={td}><b>{shortPair(order.instId)}</b></td><td className={`${td} ${order.side === "buy" ? "text-long" : "text-short"}`}>{order.side === "buy" ? "Alış" : "Satış"}</td><td className={td}>{order.avgPx && Number(order.avgPx) ? money(order.avgPx) : "-"}</td><td className={td}>{order.accFillSz || order.sz}</td><td className={td}>{order.state}</td></tr>)}</tbody></table>{!orders.length && <p className="p-6 text-center text-sm text-white/45">Şirket hesabında henüz işlem geçmişi yok.</p>}</div>
        {!!data.errors?.length && <p className="mt-2 text-xs text-amber-200">Bazı OKX verileri alınamadı: {data.errors.join(" · ")}</p>}
      </div>
    </div>
  </section>;
}
