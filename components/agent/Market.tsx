"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useState } from "react";
import { useWallet, type X402Requirements } from "@/components/wallet/WalletProvider";
import type { FleetAgentView } from "./Fleet";
import { fmtPx, short } from "@/lib/fmt";

type Signal = {
  agent: { name: string; erc8004: string | null; model: string };
  verdict: string;
  decisions: Record<string, { pick: string; jev: Record<string, number>; laya: Record<string, number> }>;
  plan: { instId: string; entry: number; tp: number; sl: number; notional: number; gate: number } | null;
  position: { instId: string; entry: number; tp: number; sl: number } | null;
  track: { trades: number; wins: number; realizedPnl: number; budget: number };
};
type Bought = { agent: string; signal: Signal; txHash?: string };

/**
 * Agent marketplace: listed agents sell their latest decision over x402.
 * The owner's own agents are free; buyers pay the agent's wallet in Fuji USDC.
 */
export function Market({ agents }: { agents: FleetAgentView[] }) {
  const w = useWallet();
  const listed = agents.filter((a) => a.listing?.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [bought, setBought] = useState<Bought | null>(null);

  const buyBrowser = async (a: FleetAgentView) => {
    const r1 = await fetch(`/api/signal/${a.id}`, { cache: "no-store" });
    if (r1.status !== 402) throw new Error((await r1.json()).error || `HTTP ${r1.status}`);
    const req = ((await r1.json()) as { accepts: X402Requirements[] }).accepts[0];
    const header = await w.signX402(req);
    const r2 = await fetch(`/api/signal/${a.id}`, { headers: { "X-PAYMENT": header }, cache: "no-store" });
    const j = await r2.json();
    if (!r2.ok) throw new Error(j.error);
    return j as { signal: Signal; txHash: string };
  };
  const buyAgentic = async (a: FleetAgentView) => {
    const r = await fetch(`/api/signal/${a.id}/agentic`, { method: "POST" });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error);
    return j as { signal: Signal; txHash: string };
  };

  const buy = async (a: FleetAgentView) => {
    setBusy(a.id);
    setErr(null);
    try {
      if (!w.address) throw new Error("Satın almak için sağ üstten cüzdan bağla");
      const j = w.mode === "browser" ? await buyBrowser(a) : await buyAgentic(a);
      setBought({ agent: a.name, signal: j.signal, txHash: j.txHash });
      w.refresh();
    } catch (e) {
      const m = (e as Error).message;
      setErr(/insufficient USDC/i.test(m) ? "Cüzdanında yeterli Fuji USDC yok (Circle faucet)." : m);
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="border-b border-ink/10 bg-paper">
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-3xl uppercase tracking-wide">Ajan pazarı</h2>
            <p className="text-sm text-muted">Kendi ajanın ücretsiz. Pazara açılan ajanların son kararı x402 ile satın alınır; ödeme ajanın cüzdanına gider.</p>
          </div>
          {err && <span className="text-sm text-short">{err}</span>}
        </div>
        {listed.length === 0 ? (
          <p className="rounded-card border border-dashed border-ink/20 p-6 text-center text-sm text-muted">Henüz pazarda ajan yok. Fuji'de kayıtlı bir ajanın kartından "Pazara aç" ile ilan verebilirsin.</p>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {listed.map((a) => {
              const wins = a.trades.filter((t) => (t.pnl ?? 0) > 0).length;
              return (
                <div key={a.id} className="flex flex-col rounded-card border border-ink/15 bg-paper p-4 shadow-card">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="font-display text-2xl uppercase leading-none">{a.name}</div>
                      <div className="mt-1 font-mono text-[11px] text-muted">{a.model.replace(/^(ollama|openrouter):/, "")}</div>
                    </div>
                    {a.chain.agentId && (
                      <a href={`https://testnet.snowtrace.io/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/${a.chain.agentId}`} target="_blank" rel="noreferrer" className="rounded-full bg-ink px-2 py-0.5 font-mono text-[10px] font-bold text-paper">
                        ERC-8004 #{a.chain.agentId}
                      </a>
                    )}
                  </div>
                  <dl className="mt-3 grid grid-cols-2 gap-y-1 font-mono text-xs">
                    <dt className="text-muted">İtibar kaydı</dt><dd className="text-right">{a.chain.feedbacks}</dd>
                    <dt className="text-muted">İşlem / kâr</dt><dd className="text-right">{a.trades.length} / {wins}</dd>
                    <dt className="text-muted">Satış</dt><dd className="text-right">{a.listing.sales} · {a.listing.revenueUsdc.toFixed(3)} USDC</dd>
                  </dl>
                  <button onClick={() => buy(a)} disabled={busy === a.id} className="mt-4 min-h-[44px] rounded-btn border border-ink/10 bg-sun font-bold shadow-btn transition-transform hover:-translate-y-px disabled:opacity-60">
                    {busy === a.id ? "x402 ödeme..." : `Sinyali al · ${a.listing.priceUsdc} USDC`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

        <AnimatePresence>
          {bought && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 rounded-card border-2 border-ink bg-sun/15 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-display text-xl uppercase">{bought.agent} · satın alınan sinyal</div>
                <div className="flex items-center gap-3 font-mono text-xs">
                  {bought.txHash && (
                    <a href={`https://testnet.snowtrace.io/tx/${bought.txHash}`} target="_blank" rel="noreferrer" className="underline">
                      x402 tx ↗
                    </a>
                  )}
                  <button onClick={() => setBought(null)} className="text-muted hover:text-ink">kapat</button>
                </div>
              </div>
              <div className="mt-3 grid gap-3 font-mono text-xs sm:grid-cols-3">
                <div>
                  <div className="text-muted">Son karar</div>
                  <div className="text-base font-bold">{bought.signal.verdict.toUpperCase()}</div>
                  {bought.signal.decisions.pair && <div>Parite: {short(bought.signal.decisions.pair.pick)}</div>}
                  {bought.signal.decisions.direction && (
                    <div>
                      Yön: {bought.signal.decisions.direction.pick === "long" ? "AL" : "BEKLE"} · JEV AL %{Math.round((bought.signal.decisions.direction.jev.long ?? 0) * 100)} · LAYA AL %{Math.round((bought.signal.decisions.direction.laya.long ?? 0) * 100)}
                    </div>
                  )}
                </div>
                <div>
                  <div className="text-muted">Plan</div>
                  {bought.signal.plan ? (
                    <>
                      <div>{short(bought.signal.plan.instId)} giriş {fmtPx(bought.signal.plan.entry)}</div>
                      <div className="text-long">TP {fmtPx(bought.signal.plan.tp)}</div>
                      <div className="text-short">SL {fmtPx(bought.signal.plan.sl)}</div>
                      <div>p(EV&gt;0) %{Math.round(bought.signal.plan.gate * 100)}</div>
                    </>
                  ) : (
                    <div>Plan yok (ajan bekliyor)</div>
                  )}
                </div>
                <div>
                  <div className="text-muted">Geçmiş</div>
                  <div>{bought.signal.track.trades} işlem · {bought.signal.track.wins} kâr</div>
                  <div>PnL {bought.signal.track.realizedPnl.toFixed(2)} USDT</div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  );
}
