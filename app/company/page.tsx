"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useWallet } from "@/components/wallet/WalletProvider";
import { startDemo } from "@/components/DemoGate";

type ModelOption = { value: string; label: string; group: string; note: string };
type CompanyMode = "ours" | "local" | "openrouter";
type CompanyStatus = { connected: boolean; companyName?: string; total?: number; assets?: number; model?: CompanyMode; modelSpec?: string; secondModelSpec?: string; queryPriceUsdc?: number; payoutAddress?: string; endpoint?: string; error?: string };
const field = "mt-1 w-full rounded-btn border border-ink/15 bg-white px-3 py-2.5 font-mono text-sm";
const usd = (n: number) => new Intl.NumberFormat("tr-TR", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

export default function CompanyPage() {
  const wallet = useWallet();
  const [options, setOptions] = useState<ModelOption[]>([]);
  const [companyName, setCompanyName] = useState("");
  const [model, setModel] = useState<CompanyMode>("ours");
  const [modelSpec, setModelSpec] = useState("");
  const [secondModelSpec, setSecondModelSpec] = useState("");
  const [openrouterModelSpec, setOpenrouterModelSpec] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [secretKey, setSecretKey] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [openrouterKey, setOpenrouterKey] = useState("");
  const [price, setPrice] = useState("0.01");
  const [status, setStatus] = useState<CompanyStatus>({ connected: false });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    void (async () => {
      let list: ModelOption[] = [];
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch("/api/models", { cache: "no-store" });
          const data = await response.json() as { options?: ModelOption[] };
          list = data.options ?? [];
          if (list.some((m) => m.value.startsWith("ollama:")) || attempt === 1) break;
        } catch {
          if (attempt === 1) break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 1200));
      }
      if (!active) return;
      setOptions(list);
      const local = list.filter((m) => m.value.startsWith("ollama:"));
      setModelSpec(local[0]?.value ?? "");
      setSecondModelSpec(local.find((m) => m.value !== local[0]?.value)?.value ?? "");
      setOpenrouterModelSpec(list.find((m) => m.value.startsWith("openrouter:") && m.value.endsWith(":free"))?.value ?? list.find((m) => m.value.startsWith("openrouter:"))?.value ?? "");
    })();
    fetch("/api/company/connect", { cache: "no-store" }).then((r) => r.json()).then((d: CompanyStatus) => {
      setStatus(d);
      if (d.model) setModel(d.model);
      if (d.modelSpec && d.model === "openrouter") setOpenrouterModelSpec(d.modelSpec);
      else if (d.modelSpec) setModelSpec(d.modelSpec);
      if (d.secondModelSpec) setSecondModelSpec(d.secondModelSpec);
      if (d.queryPriceUsdc) setPrice(String(d.queryPriceUsdc));
    }).catch(() => undefined);
    return () => { active = false; };
  }, []);

  const save = async () => {
    setBusy(true); setError("");
    try {
      const r = await fetch("/api/company/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ companyName, apiKey, secretKey, passphrase, model, modelSpec: model === "openrouter" ? openrouterModelSpec : modelSpec, secondModelSpec, openrouterKey, queryPriceUsdc: Number(price), payoutAddress: wallet.address }) });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || "Şirket hesabı bağlanamadı");
      setStatus(data); setApiKey(""); setSecretKey(""); setPassphrase(""); setOpenrouterKey("");
      setCompanyName(data.companyName ?? companyName);
    } catch (e) { setError(e instanceof Error ? e.message : "Bir hata oluştu"); }
    finally { setBusy(false); }
  };

  const disconnect = async () => {
    await fetch("/api/company/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "disconnect" }) });
    setStatus({ connected: false });
  };

  return <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
    <Link href="/" className="font-mono text-xs text-ink/50 hover:text-ink">← Aviax ana sayfa</Link>
    <div className="mt-6 grid gap-8 lg:grid-cols-[1fr_320px]">
      <section>
        <p className="font-mono text-xs uppercase tracking-[.18em] text-ink/50">AVIAX · ŞİRKET ONBOARDING</p>
        <h1 className="mt-2 font-display text-5xl leading-none sm:text-6xl">ŞİRKETİNİ ANALİZ SİSTEMİNE EKLE</h1>
        <p className="mt-4 max-w-2xl text-ink/65">Kendi OKX demo hesabını bağla, karar modelini seç ve Fuji cüzdanınla x402 üzerinden sorgu bedelini belirle. Bu bağlantı yalnızca OKX demo ortamında çalışır.</p>
        <div className="mt-4 flex flex-wrap items-center gap-3 rounded-card border-2 border-ink bg-sun/25 p-4"><span className="text-sm font-semibold">Anahtarın yok mu? Hazır demo şirket hesabıyla hemen dene.</span><button onClick={() => { void startDemo().then(() => { window.location.href = "/decision"; }).catch((e: Error) => setError(e.message)); }} className="rounded-btn border-2 border-ink bg-sun px-4 py-2 text-sm font-bold shadow-btn">Demoya geç →</button></div>

        <div className="mt-7 space-y-5">
          <section className="rounded-card border border-ink/10 bg-white p-5 sm:p-6"><label className="block text-xs font-bold uppercase tracking-wider text-ink/55">Şirket / kurum adı<input value={companyName} onChange={(e) => setCompanyName(e.target.value)} maxLength={64} className={field} placeholder="Örn. Aviax Teknoloji A.Ş." /></label><p className="mt-2 text-xs text-ink/45">Karar kayıtları ve API profilinde bu isim görünür.</p></section>
          <section className="rounded-card border border-ink/10 bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sun font-mono font-bold">1</span><div className="flex-1"><h2 className="font-display text-2xl">OKX DEMO ŞİRKET HESABI</h2><p className="mt-1 text-sm text-ink/60">OKX demo trading API anahtarları oluştur. Sadece okuma izni ver; alım satım ve para çekme izinlerini kapalı bırak.</p></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-3">
              <label className="text-xs font-bold text-ink/60">API Key<input className={field} value={apiKey} onChange={(e) => setApiKey(e.target.value)} autoComplete="off" placeholder={status.connected ? "Bağlı · değiştirmek için gir" : "Demo API Key"} /></label>
              <label className="text-xs font-bold text-ink/60">Secret Key<input className={field} type="password" value={secretKey} onChange={(e) => setSecretKey(e.target.value)} autoComplete="new-password" placeholder={status.connected ? "••••••••" : "Secret Key"} /></label>
              <label className="text-xs font-bold text-ink/60">Passphrase<input className={field} type="password" value={passphrase} onChange={(e) => setPassphrase(e.target.value)} autoComplete="new-password" placeholder={status.connected ? "••••••••" : "Passphrase"} /></label>
            </div>
            <p className="mt-3 text-xs text-ink/45">Anahtarlar yalnızca geçici sunucu belleğinde tutulur; oturum kapatılınca veya sunucu yeniden başlayınca silinir. Demo bayrağı zorunlu gönderilir.</p>
            {status.connected && <div className="mt-3 rounded-btn bg-green-50 p-3 text-sm text-green-900">OKX demo bağlı · {usd(status.total ?? 0)} · {status.assets} varlık</div>}
          </section>

          <section className="rounded-card border border-ink/10 bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sun font-mono font-bold">2</span><div className="flex-1"><h2 className="font-display text-2xl">AVALANCHE FUJI CÜZDANI</h2><p className="mt-1 text-sm text-ink/60">Şirketin x402 sorgu gelirleri bu cüzdana Fuji USDC olarak ödenir.</p></div></div>
            {wallet.address ? <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-btn bg-paper p-3"><div><b className="text-sm">Fuji cüzdanı bağlı</b><p className="font-mono text-xs text-ink/55">{wallet.address}</p><p className="mt-1 text-xs text-ink/55">{wallet.avax?.toFixed(3) ?? "–"} AVAX · {wallet.usdc?.toFixed(3) ?? "–"} USDC</p></div><button onClick={wallet.disconnect} className="rounded-btn border border-ink/15 px-3 py-2 text-xs font-bold">Bağlantıyı kes</button></div> : <div className="mt-4 flex flex-wrap gap-2"><button onClick={() => void wallet.connectBrowser()} disabled={wallet.busy} className="rounded-btn border-2 border-ink bg-sun px-4 py-2.5 text-sm font-bold">{wallet.busy ? "Bağlanıyor…" : "Core / MetaMask bağla"}</button><span className="self-center text-xs text-ink/45">Avalanche Fuji ağına geçiş istenir.</span></div>}
            {wallet.error && <p className="mt-2 text-xs text-red-700">{wallet.error}</p>}
            <div className="mt-3 flex gap-3 text-xs"><a className="underline" href="https://faucet.avax.network/" target="_blank" rel="noreferrer">Fuji AVAX faucet ↗</a><a className="underline" href="https://faucet.circle.com/" target="_blank" rel="noreferrer">Fuji USDC faucet ↗</a></div>
          </section>

          <section className="rounded-card border border-ink/10 bg-white p-5 sm:p-6">
            <div className="flex items-start gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-sun font-mono font-bold">3</span><div><h2 className="font-display text-2xl">KARAR MODELİ VE x402 TARİFESİ</h2><p className="mt-1 text-sm text-ink/60">Her API sorgusu bir JEV karar turudur. Ücret ödeyen istemci sorguyu çalıştırır; ödeme Fuji’de şirket cüzdanına gider.</p></div></div>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="text-xs font-bold text-ink/60">Karar motoru<select className={field} value={model} onChange={(e) => setModel(e.target.value as CompanyMode)}><option value="ours">Aviax modelleri · sıfır kurulum</option><option value="local">Kendi yerel Ollama modelim</option><option value="openrouter">Kendi OpenRouter anahtarım</option></select></label>
              <label className="text-xs font-bold text-ink/60">Sorgu başına Fuji USDC<input className={field} type="number" min="0.000001" max="100" step="0.001" value={price} onChange={(e) => setPrice(e.target.value)} /></label>
            </div>
            {model === "local" && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-ink/60">Ana yerel model{options.some((o) => o.value.startsWith("ollama:")) ? <select className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)}>{options.filter((o) => o.value.startsWith("ollama:")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select> : <input className={field} value={modelSpec} onChange={(e) => setModelSpec(e.target.value)} placeholder="ollama:strands-decider" />}</label><label className="text-xs font-bold text-ink/60">İkinci görüş<select className={field} value={secondModelSpec} onChange={(e) => setSecondModelSpec(e.target.value)}><option value="">İkinci görüş kapalı</option>{options.filter((o) => o.value.startsWith("ollama:") && o.value !== modelSpec).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label>{!options.some((o) => o.value.startsWith("ollama:")) && <p className="text-xs text-ink/45 sm:col-span-2">Model adını `ollama:model-adı` biçiminde gir. Aviax sunucusu bu Ollama kurulumuna erişebilmelidir.</p>}</div>}
            {model === "openrouter" && <div className="mt-3 grid gap-3 sm:grid-cols-2"><label className="text-xs font-bold text-ink/60">OpenRouter modeli<select className={field} value={openrouterModelSpec} onChange={(e) => setOpenrouterModelSpec(e.target.value)}>{options.filter((o) => o.value.startsWith("openrouter:")).map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></label><label className="text-xs font-bold text-ink/60">OpenRouter API Key<input className={field} type="password" value={openrouterKey} onChange={(e) => setOpenrouterKey(e.target.value)} autoComplete="new-password" placeholder="sk-or-…" /></label></div>}
            <p className="mt-3 text-xs text-ink/45">Aviax seçeneği sıfır kurulumdur. Yerel Ollama seçeneği bu Aviax kurulumundaki Ollama modellerini kullanır; Aviax'ı kendi bilgisayarında çalıştırırsan model doğrudan senin bilgisayarında kalır. OpenRouter anahtarı oturum belleğinde tutulur; sağlayıcı ücretleri ayrıca faturalandırılabilir. x402 ücreti şirket cüzdanına gelir.</p>
          </section>
        </div>
        {error && <p className="mt-4 rounded-btn border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
        <div className="mt-5 flex flex-wrap items-center gap-3"><button onClick={() => void save()} disabled={busy || !wallet.address} className="rounded-btn border-2 border-ink bg-sun px-5 py-3 font-bold shadow-btn disabled:opacity-50">{busy ? "Demo hesabı doğrulanıyor…" : status.connected ? "Ayarları kaydet ve doğrula" : "Şirketi ekle ve OKX demo hesabını doğrula"}</button>{!wallet.address && <span className="text-xs text-ink/50">Devam etmek için önce Fuji cüzdanını bağla.</span>}</div>
        {status.connected && status.endpoint && <div className="mt-5 rounded-card border-2 border-ink bg-ink p-5 text-white"><p className="font-mono text-xs uppercase tracking-wider text-white/50">ŞİRKET x402 DECISION API</p><p className="mt-2 text-sm">Tek JEV sorgusu: <b>{price} USDC</b> · alıcı Fuji cüzdanın</p><code className="mt-3 block break-all rounded bg-white/10 p-3 font-mono text-xs">{typeof window !== "undefined" ? window.location.origin : ""}{status.endpoint}</code><p className="mt-3 text-xs text-white/60">POST {status.endpoint} · {"{ state, questions }"} · ödeme yoksa 402 şartları, geçerli Fuji USDC imzasından sonra karar dağılımı ve karar hash’i döner.</p><Link href="/decision" className="mt-4 inline-flex rounded-btn bg-sun px-4 py-2.5 text-sm font-bold text-ink">Şirket OKX analizini başlat →</Link><button onClick={() => void disconnect()} className="ml-3 rounded-btn border border-white/20 px-4 py-2.5 text-sm font-bold">Şirket bağlantısını kaldır</button></div>}
      </section>

      <aside className="h-fit rounded-card border border-ink/10 bg-paper p-5"><p className="font-mono text-xs uppercase tracking-wider text-ink/50">KURULUM SIRASI</p><h2 className="mt-2 font-display text-3xl">BAĞLA. POLİTİKANI SEÇ. BAŞLAT.</h2><ol className="mt-5 space-y-4 text-sm"><li><b>01 · OKX demo</b><p className="mt-1 text-ink/60">Demo API anahtarlarıyla bakiye ve piyasa verisi okunur.</p></li><li><b>02 · Fuji cüzdanı</b><p className="mt-1 text-ink/60">Şirketin x402 sorgu gelirleri bu cüzdana gider.</p></li><li><b>03 · Karar kaynağı</b><p className="mt-1 text-ink/60">Aviax modellerini, bu kurulumdaki yerel Ollama modelini veya kendi OpenRouter anahtarını kullan.</p></li><li><b>04 · Risk politikası</b><p className="mt-1 text-ink/60">Analiz ekranında portföy limitlerini ayarla ve 10 saniyelik döngüyü başlat.</p></li></ol><p className="mt-5 border-t border-ink/10 pt-4 text-xs text-ink/50">Anahtarlar bu demo sunucusunda kalıcı saklanmaz. Fuji test ağı tokenları test içindir; gerçek varlık kullanılmaz.</p></aside>
    </div>
  </main>;
}
