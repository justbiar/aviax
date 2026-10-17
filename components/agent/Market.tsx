"use client";

import { useState } from "react";
import { useWallet, type X402Requirements } from "@/components/wallet/WalletProvider";
import type { FleetAgentView } from "./Fleet";

/**
 * Agent marketplace: listed agents sell scenarios over x402. The buyer pays the agent's
 * wallet in Fuji USDC and the agent runs a live decision cycle for them on the stage.
 * The owner's own agents are free.
 */
export function Market({ agents, onScenario }: { agents: FleetAgentView[]; onScenario: (name: string, start: (signal: AbortSignal) => Promise<Response>) => Promise<void> }) {
  const w = useWallet();
  const listed = agents.filter((a) => a.listing?.enabled);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const start = async (a: FleetAgentView) => {
    setBusy(a.id);
    setErr(null);
    try {
      if (!w.address) throw new Error("Senaryoyu başlatmak için sağ üstten cüzdan bağla");
      if (w.mode === "browser") {
        const r1 = await fetch(`/api/signal/${a.id}`, { cache: "no-store" });
        if (r1.status !== 402) throw new Error((await r1.json()).error || `HTTP ${r1.status}`);
        const req = ((await r1.json()) as { accepts: X402Requirements[] }).accepts[0];
        const header = await w.signX402(req);
        await onScenario(a.name, (signal) => fetch(`/api/signal/${a.id}`, { headers: { "X-PAYMENT": header }, cache: "no-store", signal }));
      } else {
        await onScenario(a.name, (signal) => fetch(`/api/signal/${a.id}/agentic`, { method: "POST", signal }));
      }
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
            <p className="text-sm text-muted">Kendi ajanın ücretsiz. Pazardaki bir ajanın senaryosunu başlat: x402 ile ödersin (ajanın cüzdanına), ajan senin için canlı bir karar turu çalıştırır ve sahnede izlersin.</p>
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
                    <dt className="text-muted">Senaryo satışı</dt><dd className="text-right">{a.listing.sales} · {a.listing.revenueUsdc.toFixed(3)} USDC</dd>
                  </dl>
                  <button onClick={() => start(a)} disabled={busy !== null} className="mt-4 min-h-[44px] rounded-btn border border-ink/10 bg-sun font-bold shadow-btn transition-transform hover:-translate-y-px disabled:opacity-60">
                    {busy === a.id ? "Senaryo çalışıyor..." : `Senaryoyu başlat · ${a.listing.priceUsdc} USDC`}
                  </button>
                </div>
              );
            })}
          </div>
        )}

      </div>
    </section>
  );
}
