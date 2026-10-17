"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { ModelOption } from "@/lib/models";
import { useWallet } from "@/components/wallet/WalletProvider";

type Policy = { maxWeight: number; maxDrawdown: number; minReserve: number; maxVol: number; approvalUsd: number };
type Settings = { connected: boolean; companyName?: string; payoutAddress?: string; model?: "ours" | "local" | "openrouter"; modelSpec?: string; secondModelSpec?: string; riskPolicy?: Policy };
type ChainAgent = { id: string; name: string; status: "off" | "awaiting_funds" | "launching" | "registered" | "failed"; wallet: string; agentId: string | null; error?: string; explorer: string };
type LaunchStatus = { connected: boolean; agent: ChainAgent | null; balance?: { avax: number; usdc: number } };

const DEFAULT_POLICY: Policy = { maxWeight: 40, maxDrawdown: 15, minReserve: 20, maxVol: 60, approvalUsd: 10_000 };
const field = "mt-1 w-full rounded-btn border border-ink/15 bg-white px-3 py-2.5 font-mono text-sm";

export function CompanyAgentSettings() {
  const wallet = useWallet();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [model, setModel] = useState<"ours" | "local" | "openrouter">("ours");
  const [modelSpec, setModelSpec] = useState("");
  const [secondModelSpec, setSecondModelSpec] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [policy, setPolicy] = useState<Policy>(DEFAULT_POLICY);
  const [launch, setLaunch] = useState<LaunchStatus | null>(null);
  const [saving, setSaving] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const loadLaunch = useCallback(async () => {
    const response = await fetch("/api/company/launch", { cache: "no-store" });
    const data = await response.json() as LaunchStatus;
    setLaunch(data);
    return data;
  }, []);

  useEffect(() => {
    let active = true;
    void Promise.all([
      fetch("/api/company/settings", { cache: "no-store" }).then((r) => r.json() as Promise<Settings>),
      fetch("/api/models", { cache: "no-store" }).then((r) => r.json() as Promise<{ options?: ModelOption[] }>),
    ]).then(([s, m]) => {
      if (!active) return;
      const list = m.options ?? [];
      setSettings(s);
      setOptions(list);
      if (s.model) setModel(s.model);
      setModelSpec(s.modelSpec ?? list.find((o) => o.value.startsWith("ollama:"))?.value ?? "");
      setSecondModelSpec(s.secondModelSpec ?? list.find((o) => o.value.startsWith("ollama:") && o.value !== s.modelSpec)?.value ?? "");
      setPolicy({ ...DEFAULT_POLICY, ...(s.riskPolicy ?? {}) });
    }).catch(() => { if (active) setError("Şirket ayarları yüklenemedi."); });
    void loadLaunch().catch(() => undefined);
    return () => { active = false; };
  }, [loadLaunch]);

  const save = async () => {
    setSaving(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/company/settings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ model, modelSpec, secondModelSpec, openrouterKey, riskPolicy: policy }) });
      const result = await response.json() as Settings & { error?: string };
      if (!response.ok) throw new Error(result.error ?? "Ayarlar kaydedilemedi");
      setSettings(result); setOpenrouterKey(""); setMessage("Şirket ajanı ayarları kaydedildi. OKX analiz turları bu ayarları kullanacak.");
    } catch (e) { setError(e instanceof Error ? e.message : "Ayarlar kaydedilemedi"); }
    finally { setSaving(false); }
  };

  const deploy = async () => {
    setLaunching(true); setError(""); setMessage("");
    try {
      if (wallet.mode !== "browser" || !wallet.address || wallet.address.toLowerCase() !== settings?.payoutAddress?.toLowerCase()) throw new Error("Şirket kaydındaki Fuji cüzdanıyla tarayıcı cüzdanını bağla.");
      const response = await fetch("/api/company/launch", { method: "POST" });
      const result = await response.json() as { agent?: ChainAgent; reused?: boolean; error?: string };
      if (!response.ok || !result.agent) throw new Error(result.error ?? "Şirket ajanı oluşturulamadı");
      setLaunch((old) => ({ connected: true, agent: result.agent!, balance: old?.balance }));
      let current = await loadLaunch();
      if (current.agent?.status !== "registered" && (current.balance?.avax ?? 0) < 0.01) {
        setMessage("Fuji kaydı için cüzdanında 0,03 AVAX işlemine onay ver.");
        await wallet.fund(result.agent.wallet as `0x${string}`, 0.03, 0);
      }
      setMessage("Fuji ERC-8004 kaydı bekleniyor… Bu ajan şirket risk ayarlarını zincirde temsil eder, OKX emri göndermez.");
      for (let attempt = 0; attempt < 24; attempt += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 2500));
        current = await loadLaunch();
        if (current.agent?.status === "registered") { setMessage(`Şirket ajanı Fuji'de kaydedildi · ERC-8004 #${current.agent.agentId}`); break; }
        if (current.agent?.status === "failed") throw new Error(current.agent.error ?? "Fuji kaydı başarısız");
      }
    } catch (e) { setError(e instanceof Error ? e.message : "Fuji kaydı başlatılamadı"); }
    finally { setLaunching(false); }
  };

  const localModels = options.filter((o) => o.value.startsWith("ollama:"));
  const openrouterModels = options.filter((o) => o.value.startsWith("openrouter:"));
  const setLimit = (key: keyof Policy, value: number) => setPolicy((current) => ({ ...current, [key]: value }));

  return <section className="border-y border-ink/10 bg-paper py-8">
    <div className="mx-auto max-w-[1100px] px-4 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><p className="font-mono text-xs uppercase tracking-wider text-muted">OKX şirket ajanı</p><h2 className="mt-1 font-display text-3xl uppercase">AJAN AYARLARI VE FUJI KAYDI</h2></div><Link href="/decision" className="text-sm font-semibold underline">OKX analiz ekranı →</Link></div>
      {!settings?.connected ? <div className="rounded-card border border-ink/10 bg-white p-5"><p className="text-sm text-muted">Şirket ajanı ayarlarını yönetmek için önce şirket hesabını ekle.</p><Link href="/company" className="mt-3 inline-flex rounded-btn border-2 border-ink bg-sun px-4 py-2.5 text-sm font-bold">Şirketi bağla →</Link></div> : <div className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="rounded-card border border-ink/10 bg-white p-5">
          <div className="grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-ink/60">Şirket karar modeli<select className={field} value={model} onChange={(e) => { const next = e.target.value as typeof model; setModel(next); if (next === "local" && !modelSpec.startsWith("ollama:")) setModelSpec(localModels[0]?.value ?? ""); if (next === "openrouter" && !modelSpec.startsWith("openrouter:")) setModelSpec(openrouterModels[0]?.value ?? ""); }}><option value="ours">Aviax yerel karar modelleri</option><option value="local">Kendi yerel Ollama modelim</option><option value="openrouter">Kendi OpenRouter anahtarım</option></select></label>
            {model === "local" && <label className="text-xs font-bold text-ink/60">Ana yerel model{localModels.length ? <select className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)}>{localModels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)} placeholder="ollama:model-adı" />}</label>}
            {model === "local" && localModels.length > 1 && <label className="text-xs font-bold text-ink/60">İkinci görüş<select className={field} value={secondModelSpec} onChange={(e) => setSecondModelSpec(e.target.value)}><option value="">İkinci görüş kapalı</option>{localModels.filter((o) => o.value !== modelSpec).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>}
            {model === "openrouter" && <><label className="text-xs font-bold text-ink/60">OpenRouter modeli{openrouterModels.length ? <select className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)}>{openrouterModels.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)} placeholder="openrouter:sağlayıcı/model" />}</label><label className="text-xs font-bold text-ink/60">OpenRouter anahtarı<input className={field} type="password" autoComplete="new-password" value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} placeholder="Boş bırakırsan kayıtlı anahtar kalır" /></label></>}
          </div>
          <p className="mt-2 text-xs text-muted">Yerel Ollama modeli Aviax sunucusundan erişilebilir olmalı. OpenRouter anahtarı bu şirket oturumunda tutulur ve tarayıcıya geri gönderilmez.</p>
          <h3 className="mt-5 font-display text-xl">ŞİRKET RİSK SINIRLARI</h3>
          <div className="mt-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{([ ["maxWeight", "Varlık üst sınırı %"], ["maxDrawdown", "Maks. düşüş %"], ["minReserve", "Min. nakit rezerv %"], ["maxVol", "Maks. yıllık oynaklık %"], ["approvalUsd", "İnsan onay eşiği $"] ] as [keyof Policy, string][]).map(([key, title]) => <label key={key} className="text-[11px] font-semibold text-ink/60">{title}<input className={field} type="number" min="0" max={key === "approvalUsd" ? 1_000_000_000 : 100} value={policy[key]} onChange={(e) => setLimit(key, Number(e.target.value))} /></label>)}</div>
          {error && <p className="mt-3 rounded-btn bg-red-50 p-3 text-sm text-red-800">{error}</p>}{message && <p className="mt-3 rounded-btn bg-green-50 p-3 text-sm text-green-900">{message}</p>}
          <button onClick={() => void save()} disabled={saving} className="mt-4 rounded-btn border-2 border-ink bg-sun px-4 py-2.5 text-sm font-bold disabled:opacity-50">{saving ? "Kaydediliyor…" : "Ayarları kaydet"}</button>
        </div>
        <div className="rounded-card border border-ink/10 bg-stage p-5 text-white"><p className="font-mono text-xs uppercase tracking-wider text-sun">Avalanche Fuji · ERC-8004</p><h3 className="mt-1 font-display text-2xl">ŞİRKET AJANINI FIRLAT</h3><p className="mt-2 text-sm text-white/55">Şirket adı, karar modeli ve risk politikası hash’iyle şirkete özel ajan kimliği kaydet. Bu kayıt OKX’te emir vermez.</p>
          {launch?.agent ? <div className="mt-4 rounded-btn border border-white/10 bg-black/25 p-3"><b>{launch.agent.name}</b><p className="mt-1 font-mono text-xs text-white/50">{launch.agent.status === "registered" ? `Fuji'de kayıtlı · ERC-8004 #${launch.agent.agentId}` : launch.agent.status === "failed" ? "Kayıt başarısız" : "Fuji kaydı bekleniyor"}</p>{launch.balance && <p className="mt-1 font-mono text-xs text-white/40">Ajan cüzdanı · {launch.balance.avax.toFixed(3)} AVAX</p>}<a className="mt-2 inline-block text-xs underline" href={launch.agent.explorer} target="_blank" rel="noreferrer">Ajan cüzdanını Snowtrace’te gör ↗</a>{launch.agent.status === "registered" && <p className="mt-2 text-[11px] text-white/45">Zincir kaydı, ilk yayın anındaki model ve politika hash’inin anlık görüntüsüdür. OKX analizinde sonradan kaydettiğin ayarlar kullanılmaya devam eder.</p>}{launch.agent.error && <p className="mt-2 text-xs text-red-200">{launch.agent.error}</p>}</div> : <p className="mt-4 rounded-btn border border-dashed border-white/15 p-3 text-sm text-white/50">Henüz şirket ajanı kaydedilmedi.</p>}
          {wallet.mode !== "browser" || !wallet.address || wallet.address.toLowerCase() !== settings.payoutAddress?.toLowerCase() ? <div className="mt-4"><p className="text-xs text-white/50">Kayıtlı şirket cüzdanıyla tarayıcı cüzdanını bağla: {settings.payoutAddress?.slice(0, 6)}…{settings.payoutAddress?.slice(-4)}</p><button onClick={() => void wallet.connectBrowser()} disabled={wallet.busy} className="mt-2 rounded-btn border border-white/20 px-3 py-2 text-xs font-bold">{wallet.busy ? "Bağlanıyor…" : "Şirket cüzdanını bağla"}</button></div> : <p className="mt-4 text-xs text-white/50">Fuji kayıt gas’ı için en fazla 0,03 AVAX’ı ajan cüzdanına göndermen istenir. İşlem tarayıcı cüzdanında ayrıca onaylanır.</p>}
          <button onClick={() => void deploy()} disabled={launching || wallet.mode !== "browser" || !wallet.address || wallet.address.toLowerCase() !== settings.payoutAddress?.toLowerCase() || launch?.agent?.status === "registered"} className="mt-4 w-full rounded-btn border-2 border-ink bg-sun px-4 py-2.5 text-sm font-bold text-ink disabled:opacity-50">{launching ? "Fuji’ye kaydediliyor…" : launch?.agent?.status === "registered" ? "Şirket ajanı Fuji’de kayıtlı" : launch?.agent ? "Fuji kaydını sürdür" : "Şirket ajanını Fuji’ye kaydet"}</button>
        </div>
      </div>}
    </div>
  </section>;
}
