"use client";

import { useState } from "react";
import { fmtNum, fmtPx, short } from "@/lib/fmt";

export type Account = {
  configured: boolean;
  balance?: { totalEq: string; details: { ccy: string; eq: string; availBal: string; upl: string }[] } | null;
  assets?: { ccy: string; eq: string; availBal: string; eqUsd?: string; upl: string }[];
  orders?: { ordId: string; instId: string; side: string; ordType: string; px: string; sz: string; accFillSz: string; state: string; cTime: string }[];
  algos?: { algoId: string; instId: string; tpTriggerPx: string; slTriggerPx: string; sz: string; side: string; state: string }[];
  history?: { ordId: string; instId: string; side: string; ordType: string; avgPx: string; sz: string; state: string; cTime: string }[];
  errors?: string[];
};

const TABS = ["Varlıklar", "Açık emirler", "TP / SL", "Geçmiş"] as const;

export function AccountPanel({ acct, reload }: { acct: Account | null; reload: () => void }) {
  const [tab, setTab] = useState<(typeof TABS)[number]>("Varlıklar");

  const act = async (body: Record<string, string>) => {
    await fetch("/api/order", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    reload();
  };

  if (!acct) return <div className="p-6 text-sm text-muted">Hesap yükleniyor...</div>;
  if (!acct.configured)
    return (
      <div className="p-6 text-sm">
        <b>OKX demo anahtarları eksik.</b> <span className="text-muted">.env.local dosyasına OKX_API_KEY, OKX_SECRET_KEY ve OKX_PASSPHRASE ekleyip sunucuyu yeniden başlat.</span>
      </div>
    );

  const counts: Record<string, number> = {
    Varlıklar: acct.assets?.length ?? 0,
    "Açık emirler": acct.orders?.length ?? 0,
    "TP / SL": acct.algos?.length ?? 0,
    Geçmiş: acct.history?.length ?? 0,
  };
  const th = "px-3 py-2 text-left font-mono text-[10px] font-medium uppercase tracking-wider text-muted";
  const td = "px-3 py-2 font-mono text-xs num whitespace-nowrap";

  return (
    <div>
      <div className="flex items-center gap-1 overflow-x-auto border-b border-ink/10 px-2 scroll-thin">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`relative whitespace-nowrap px-3 py-3 text-sm font-bold transition-colors ${tab === t ? "text-ink" : "text-ink/45 hover:text-ink"}`}>
            {t} <span className="font-mono text-xs text-muted">{counts[t]}</span>
            {tab === t && <span className="absolute inset-x-3 -bottom-px h-[3px] rounded-full bg-sun" />}
          </button>
        ))}
        {acct.balance && (
          <div className="ml-auto whitespace-nowrap px-3 font-mono text-xs">
            <span className="text-muted">Equity </span>
            <b className="num">{fmtNum(acct.balance.totalEq, 2)} USD</b>
          </div>
        )}
      </div>
      {acct.errors && acct.errors.length > 0 && <p className="bg-short/10 px-4 py-2 text-xs text-short">{acct.errors.join(" · ")}</p>}
      <div className="max-h-[280px] overflow-auto scroll-thin">
        <table className="w-full">
          {tab === "Varlıklar" && (
            <>
              <thead><tr><th className={th}>Varlık</th><th className={th}>Toplam</th><th className={th}>Kullanılabilir</th><th className={th}>USD değeri</th></tr></thead>
              <tbody>
                {acct.assets?.map((x) => (
                  <tr key={x.ccy} className="border-t border-ink/5">
                    <td className={td}><b>{x.ccy}</b></td>
                    <td className={td}>{fmtNum(x.eq, x.ccy === "USDT" || x.ccy === "TRY" ? 2 : 6)}</td>
                    <td className={td}>{fmtNum(x.availBal, x.ccy === "USDT" || x.ccy === "TRY" ? 2 : 6)}</td>
                    <td className={`${td} text-muted`}>{x.eqUsd ? fmtNum(x.eqUsd, 2) : "-"}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === "Açık emirler" && (
            <>
              <thead><tr><th className={th}>Kontrat</th><th className={th}>Yön</th><th className={th}>Tip</th><th className={th}>Fiyat</th><th className={th}>Miktar</th><th className={th}>Dolan</th><th className={th} /></tr></thead>
              <tbody>
                {acct.orders?.map((o) => (
                  <tr key={o.ordId} className="border-t border-ink/5">
                    <td className={td}><b>{short(o.instId)}</b></td>
                    <td className={`${td} ${o.side === "buy" ? "text-long" : "text-short"}`}>{o.side}</td>
                    <td className={td}>{o.ordType}</td>
                    <td className={td}>{fmtPx(o.px)}</td>
                    <td className={td}>{o.sz}</td>
                    <td className={td}>{o.accFillSz}</td>
                    <td className={td}><button onClick={() => act({ action: "cancel", instId: o.instId, ordId: o.ordId })} className="rounded-md border border-ink/20 px-2 py-1 text-[11px] font-bold hover:bg-ink hover:text-paper">İptal</button></td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === "TP / SL" && (
            <>
              <thead><tr><th className={th}>Kontrat</th><th className={th}>Yön</th><th className={th}>TP</th><th className={th}>SL</th><th className={th}>Miktar</th><th className={th}>Durum</th></tr></thead>
              <tbody>
                {acct.algos?.map((a) => (
                  <tr key={a.algoId} className="border-t border-ink/5">
                    <td className={td}><b>{short(a.instId)}</b></td>
                    <td className={td}>{a.side}</td>
                    <td className={`${td} text-long`}>{fmtPx(a.tpTriggerPx)}</td>
                    <td className={`${td} text-short`}>{fmtPx(a.slTriggerPx)}</td>
                    <td className={td}>{a.sz}</td>
                    <td className={td}>{a.state}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
          {tab === "Geçmiş" && (
            <>
              <thead><tr><th className={th}>Zaman</th><th className={th}>Kontrat</th><th className={th}>Yön</th><th className={th}>Tip</th><th className={th}>Ort. fiyat</th><th className={th}>Miktar</th><th className={th}>Durum</th></tr></thead>
              <tbody>
                {acct.history?.map((o) => (
                  <tr key={o.ordId} className="border-t border-ink/5">
                    <td className={`${td} text-muted`}>{new Date(Number(o.cTime)).toLocaleString("tr-TR")}</td>
                    <td className={td}><b>{short(o.instId)}</b></td>
                    <td className={`${td} ${o.side === "buy" ? "text-long" : "text-short"}`}>{o.side}</td>
                    <td className={td}>{o.ordType}</td>
                    <td className={td}>{fmtPx(o.avgPx)}</td>
                    <td className={td}>{o.sz}</td>
                    <td className={td}>{o.state}</td>
                  </tr>
                ))}
              </tbody>
            </>
          )}
        </table>
        {counts[tab] === 0 && <p className="p-6 text-center text-sm text-muted">Kayıt yok</p>}
      </div>
    </div>
  );
}
