"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useWallet } from "./WalletProvider";

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

type CompanyAccount = { connected: boolean; companyName?: string; balance?: { totalEq: string } | null; assets?: { ccy: string; eq: string; eqUsd?: string }[]; errors?: string[] };

/** Public visitors connect their own isolated company demo account from onboarding. */
function OkxSection({ open }: { open: boolean }) {
  const [acct, setAcct] = useState<CompanyAccount | null>(null);
  useEffect(() => {
    if (!open) return;
    let alive = true;
    const load = () => fetch("/api/company/activity", { cache: "no-store" }).then((r) => r.json()).then((j) => alive && setAcct(j)).catch(() => null);
    load();
    const id = setInterval(load, 8000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [open]);

  const assets = (acct?.assets ?? []).filter((a) => Number(a.eqUsd ?? 0) >= 0.01).sort((x, y) => Number(y.eqUsd ?? 0) - Number(x.eqUsd ?? 0));
  const fmt = (v: string | number, d: number) => Number(v).toLocaleString("en-US", { maximumFractionDigits: d });

  return (
    <div className="space-y-2 border-t border-ink/10 pt-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="grid h-6 w-6 place-items-center rounded-md bg-ink font-display text-[10px] text-paper">OKX</span>
          <span className="text-xs font-bold uppercase tracking-wider text-muted">Şirket portföyü</span>
        </div>
        <span className={`flex items-center gap-1.5 text-[11px] font-semibold ${acct?.connected ? "text-long" : "text-muted"}`}>
          <span className={`h-1.5 w-1.5 rounded-full ${acct?.connected ? "bg-long" : "bg-ink/25"}`} />
          {acct === null ? "yükleniyor" : acct.connected ? "bağlı" : "bağlı değil"}
        </span>
      </div>
      {acct?.connected && acct.balance && (
        <>
          <div className="rounded-btn bg-ink/[0.04] p-2">
            <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">{acct.companyName ?? "Şirket"} · toplam varlık</div>
            <div className="font-mono text-lg font-bold num">${fmt(acct.balance.totalEq, 2)}</div>
          </div>
          <div className="max-h-[150px] space-y-1 overflow-y-auto scroll-thin">
            {assets.map((a) => (
              <div key={a.ccy} className="flex items-center justify-between font-mono text-xs">
                <span className="font-bold">{a.ccy}</span>
                <span className="text-ink/70">{fmt(a.eq, a.ccy === "USDT" || a.ccy === "TRY" ? 2 : 6)}</span>
                <span className="w-20 text-right text-muted">${fmt(a.eqUsd ?? 0, 2)}</span>
              </div>
            ))}
          </div>
          <Link href="/trade" className="block rounded-btn border border-ink/15 py-2 text-center text-xs font-bold hover:border-ink">
            Trade ekranında aç →
          </Link>
        </>
      )}
      {acct && !acct.connected && <Link href="/company" className="block text-xs text-muted underline">Şirket portföyünü bağla →</Link>}
      {acct?.errors && acct.errors.length > 0 && <p className="text-xs text-short">{acct.errors[0]}</p>}
    </div>
  );
}

/** Deterministic two-colour avatar from the address. */
function Avatar({ address, size = 24 }: { address: string; size?: number }) {
  const h1 = parseInt(address.slice(2, 8), 16) % 360;
  const h2 = parseInt(address.slice(-6), 16) % 360;
  return <span className="inline-block shrink-0 rounded-full border border-ink/20" style={{ width: size, height: size, background: `linear-gradient(135deg, hsl(${h1} 85% 60%), hsl(${h2} 85% 45%))` }} aria-hidden />;
}

export function WalletMenu() {
  const w = useWallet();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const copy = async () => {
    if (!w.address) return;
    try {
      await navigator.clipboard.writeText(w.address);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  const empty = w.address && (w.avax ?? 0) < 0.03;
  const [isPublic, setIsPublic] = useState(false);
  useEffect(() => setIsPublic(!/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname)), []);

  return (
    <div ref={box} className="relative">
      {w.address ? (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-[40px] items-center gap-2 rounded-full border border-ink/15 bg-paper py-1 pl-1 pr-3 text-sm font-semibold shadow-btn transition-colors hover:border-ink/40">
          <Avatar address={w.address} />
          <span className="hidden font-mono text-xs sm:inline">{short(w.address)}</span>
          <span className={`h-2 w-2 rounded-full ${empty ? "bg-sun" : "bg-long"}`} />
        </button>
      ) : (
        <button onClick={() => setOpen((o) => !o)} aria-expanded={open} className="min-h-[40px] rounded-btn border border-ink/10 bg-sun px-4 text-sm font-bold shadow-btn transition-transform hover:-translate-y-px">
          Bağlan
        </button>
      )}

      {open && (
        <div className="absolute right-0 top-12 z-50 max-h-[calc(100vh-80px)] w-[300px] overflow-y-auto rounded-card border border-ink/15 bg-paper p-3 shadow-card scroll-thin">
          {!w.address ? (
            <div className="space-y-2">
              <div className="px-1 text-xs font-bold uppercase tracking-wider text-muted">Avalanche Fuji</div>
              <button onClick={() => w.connectBrowser()} disabled={w.busy} className="w-full rounded-btn border border-ink/15 p-3 text-left transition-colors hover:border-ink disabled:opacity-60">
                <div className="font-bold">Cüzdan ile bağlan</div>
                <div className="text-xs text-muted">{w.hasInjected ? "Core veya MetaMask. Ajan fonlamasını sen onaylarsın." : "Tarayıcıda Core veya MetaMask bulunamadı."}</div>
              </button>
              <button onClick={() => w.createAgentic()} disabled={w.busy || isPublic} title={isPublic ? "Sadece sunum makinesinden" : undefined} className="w-full rounded-btn border-2 border-ink bg-sun/25 p-3 text-left transition-colors hover:bg-sun/40 disabled:opacity-50">
                <div className="font-bold">Agentic wallet oluştur</div>
                <div className="text-xs text-muted">Uygulama senin için bir Fuji cüzdanı açar. Bir kez doldurursun, ajanları o fonlar ve x402 ile itibarı otomatik yönetir.</div>
              </button>
              {w.error && <p className="px-1 text-xs text-short">{w.error}</p>}
              <OkxSection open={open} />
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <Avatar address={w.address} size={40} />
                <div className="min-w-0">
                  <div lang="en" className="text-xs font-bold uppercase tracking-wider text-muted">{w.mode === "agentic" ? "Agentic wallet" : "Browser wallet"}</div>
                  <button onClick={copy} className="font-mono text-sm hover:underline" title="Adresi kopyala">
                    {copied ? "Kopyalandı" : short(w.address)}
                  </button>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-btn bg-ink/[0.04] p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">AVAX</div>
                  <div className="font-mono font-bold num">{w.avax === null ? "-" : w.avax.toFixed(3)}</div>
                </div>
                <div className="rounded-btn bg-ink/[0.04] p-2">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">USDC</div>
                  <div className="font-mono font-bold num">{w.usdc === null ? "-" : w.usdc.toFixed(2)}</div>
                </div>
              </div>
              {empty && (
                <div className="space-y-1 rounded-btn border border-sun bg-sun/15 p-2 text-xs">
                  <div className="font-semibold">Cüzdanı Fuji testnet'ten doldur:</div>
                  <a className="block underline" href="https://core.app/tools/testnet-faucet/?subnet=c&token=c" target="_blank" rel="noreferrer">AVAX faucet ↗</a>
                  <a className="block underline" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">USDC faucet (Avalanche Fuji) ↗</a>
                </div>
              )}
              <div className="flex gap-2">
                <a href={`https://testnet.snowtrace.io/address/${w.address}`} target="_blank" rel="noreferrer" className="flex-1 rounded-btn border border-ink/15 py-2 text-center text-xs font-bold hover:border-ink">
                  Snowtrace ↗
                </a>
                <button onClick={() => { w.disconnect(); setOpen(false); }} className="flex-1 rounded-btn border border-ink/15 py-2 text-xs font-bold hover:border-short hover:text-short">
                  Bağlantıyı kes
                </button>
              </div>
              <OkxSection open={open} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
