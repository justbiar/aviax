"use client";

import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";

/**
 * Agentic HR: the company's board of agents. In-house staff (the company's own risk desk),
 * hired agents (paid with x402 on Fuji, platform commission recorded) and the marketplace of
 * listed agents that can be hired onto the board.
 */

const EASE = [0.22, 1, 0.36, 1] as const;
const tx = (h: string) => `https://testnet.snowtrace.io/tx/${h}`;
const nft = (id: string) => `https://testnet.snowtrace.io/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/${id}`;
const short = (m: string) => m.replace(/^ollama:/, "").replace(/^openrouter:/, "").replace(/:free$/, "");

type Hire = { agentId: string; name: string; erc8004: string | null; role: string; priceUsdc: number; commissionUsdc: number; agentNetUsdc: number; tx: string; hiredAt: number };
type Listed = { id: string; name: string; erc8004: string | null; model: string; validator: string; priceUsdc: number; sales: number; trades: number; wins: number; platform: boolean; skills: string[] };
type Data = {
  connected: boolean;
  companyName?: string;
  commissionPct: number;
  inHouse?: { id: string; name: string; erc8004: string | null; role: string }[];
  members: Hire[];
  market: Listed[];
  totals?: { hires: number; spentUsdc: number; commissionUsdc: number };
};

export function Board() {
  const [d, setD] = useState<Data | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => fetch("/api/board", { cache: "no-store" }).then((r) => r.json()).then(setD).catch(() => {}), []);
  useEffect(() => { void load(); }, [load]);

  const act = async (action: "hire" | "release", id: string, name: string) => {
    setBusy(id);
    setMsg(null);
    try {
      const r = await fetch("/api/board", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, id }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || "İşlem başarısız");
      setMsg({ ok: true, text: action === "hire" ? `${name} kadroya katıldı · x402 ödemesi Fuji'de settle edildi` : `${name} kadrodan çıkarıldı` });
      await load();
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(null);
    }
  };

  if (!d?.connected) return null;
  const pct = d.commissionPct;

  return (
    <section className="stage border-t border-white/10 bg-stage text-white">
      <div className="mx-auto max-w-[1440px] space-y-4 px-3 py-6 sm:px-6 sm:py-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="font-mono text-[10px] uppercase tracking-[.18em] text-sun">Agentic HR · {d.companyName}</p>
            <h2 className="mt-1 font-display text-3xl tracking-wide sm:text-4xl">YÖNETİM KURULU</h2>
            <p className="mt-1 max-w-[760px] text-sm text-white/55">
              Şirketler pazardaki ajanları kadrolarına kiralar. Kiralama x402 ile ödenir ve Fuji'de ajanın kendi cüzdanına settle edilir; her kiralamadan ve hizmetten platform %{pct} komisyon alır. Ajanların kimliği ve geçmişi ERC-8004'te.
            </p>
          </div>
          {d.totals && (
            <div className="flex gap-4 font-mono text-[11px]">
              <span className="text-white/50">kiralama <b className="text-white">{d.totals.hires}</b></span>
              <span className="text-white/50">ödenen <b className="text-white">{d.totals.spentUsdc} USDC</b></span>
              <span className="text-white/50">platform komisyonu <b className="text-sun">{d.totals.commissionUsdc} USDC</b></span>
            </div>
          )}
        </div>

        {msg && <div className={`rounded-xl border px-4 py-2 font-mono text-xs ${msg.ok ? "border-[rgb(0,200,120)]/40 text-[rgb(0,200,120)]" : "border-[rgb(255,80,80)]/40 text-[rgb(255,120,120)]"}`}>{msg.text}</div>}

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          {/* board */}
          <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
            <h3 className="font-display text-xl tracking-wide">Kadro</h3>
            <div className="mt-3 space-y-2">
              {(d.inHouse ?? []).map((m) => (
                <div key={m.id} className="flex items-center justify-between gap-3 rounded-xl border border-sun/30 bg-sun/[0.06] px-3 py-2.5">
                  <div className="min-w-0">
                    <div className="truncate font-display text-lg tracking-wide">{m.name}</div>
                    <div className="font-mono text-[10px] text-white/55">{m.role} · şirket içi</div>
                  </div>
                  {m.erc8004 && <a href={nft(m.erc8004)} target="_blank" rel="noreferrer" className="shrink-0 font-mono text-[11px] text-sun hover:underline">ERC-8004 #{m.erc8004} ↗</a>}
                </div>
              ))}
              {d.members.map((m, i) => (
                <motion.div key={m.agentId} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: EASE, delay: i * 0.04 }} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate font-display text-lg tracking-wide">{m.name}</div>
                      <div className="font-mono text-[10px] text-white/55">{m.role} · {new Date(m.hiredAt).toLocaleString("tr-TR")}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 font-mono text-[11px]">
                      {m.erc8004 && <a href={nft(m.erc8004)} target="_blank" rel="noreferrer" className="text-white/70 hover:text-sun">#{m.erc8004} ↗</a>}
                      <button onClick={() => act("release", m.agentId, m.name)} disabled={busy === m.agentId} className="rounded border border-white/15 px-2 py-0.5 text-white/60 hover:border-white/40 hover:text-white disabled:opacity-50">çıkar</button>
                    </div>
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-0.5 font-mono text-[10px] text-white/50">
                    <span>kiralama {m.priceUsdc} USDC</span>
                    <span>ajana {m.agentNetUsdc} USDC</span>
                    <span className="text-sun">platform %{pct} · {m.commissionUsdc} USDC</span>
                    <a href={tx(m.tx)} target="_blank" rel="noreferrer" className="text-[rgb(0,200,120)] hover:underline">x402 Fuji ↗</a>
                  </div>
                </motion.div>
              ))}
              {d.members.length === 0 && <p className="font-mono text-xs text-white/40">Henüz kiralanan ajan yok. Pazardan bir ajanı kadroya kat.</p>}
            </div>
          </div>

          {/* market */}
          <div className="rounded-card border border-white/10 bg-white/[0.02] p-4">
            <h3 className="font-display text-xl tracking-wide">Ajan pazarı</h3>
            <div className="mt-3 space-y-2">
              {d.market.map((a) => (
                <div key={a.id} className="rounded-xl border border-white/10 bg-black/30 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="truncate font-display text-lg tracking-wide">{a.name}</span>
                        <span className={`rounded-full px-2 py-0.5 font-mono text-[9px] font-bold ${a.platform ? "bg-sun text-black" : "bg-white/10 text-white/70"}`}>{a.platform ? "AVIAX HİZMET AJANI" : "TOPLULUK"}</span>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] text-white/50">{short(a.model)} + {short(a.validator)} · {a.erc8004 ? `ERC-8004 #${a.erc8004}` : "kimlik yok"} · {a.trades} işlem · {a.sales} hizmet satışı</div>
                      <div className="mt-1 flex flex-wrap gap-1">{a.skills.map((s) => <span key={s} className="rounded bg-white/[0.06] px-1.5 py-0.5 font-mono text-[9px] text-white/60">{s}</span>)}</div>
                    </div>
                    <button onClick={() => act("hire", a.id, a.name)} disabled={busy !== null} className="shrink-0 rounded-btn border-2 border-sun bg-sun px-3 py-1.5 text-xs font-bold text-black disabled:opacity-50">
                      {busy === a.id ? "x402 ödeniyor…" : `Kadroya kat · ${a.priceUsdc} USDC`}
                    </button>
                  </div>
                </div>
              ))}
              {d.market.length === 0 && <p className="font-mono text-xs text-white/40">Pazardaki bütün ajanlar kadroda.</p>}
            </div>
            <p className="mt-3 font-mono text-[10px] text-white/35">Kiralama: 402 → şirket cüzdanı EIP-3009 imzalar → Fuji'de USDC ajanın cüzdanına settle. Komisyon %{pct}, her kiralama ve hizmet satışında.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
