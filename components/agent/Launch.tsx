"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import type { ModelOption } from "@/lib/models";
import { useWallet } from "@/components/wallet/WalletProvider";

const EASE = [0.22, 1, 0.36, 1] as const;
const field = "w-full rounded-btn border border-ink/20 bg-paper px-3 py-2.5 text-sm outline-none transition-shadow focus:border-ink focus:shadow-[0_0_0_3px_rgb(var(--sun)/0.5)]";
const label = "mb-1 block text-xs font-semibold text-muted";
const PAIRS = ["BTC", "ETH", "SOL", "AVAX", "XRP", "DOGE", "LINK", "SUI", "NEAR", "ZEC"];
const STEPS = ["Model", "Yetkiler", "Fuji'ye fırlat"] as const;

const GAS_AVAX = 0.03;
const X402_USDC = 0.2;

export function LaunchWizard({ onLaunched }: { onLaunched: (id: string) => void }) {
  const [step, setStep] = useState(0);
  const [options, setOptions] = useState<ModelOption[]>([]);
  const w = useWallet();
  // Public tunnel visitors build agents without the operator's Fuji funds.
  const [isPublic, setIsPublic] = useState(false);
  useEffect(() => {
    const pub = !/^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
    setIsPublic(pub);
    if (pub) setOnFuji(false);
  }, []);
  const [launchNote, setLaunchNote] = useState<string | null>(null);

  // step 1
  const [name, setName] = useState("");
  const [source, setSource] = useState<"local" | "openrouter">("local");
  const [model, setModel] = useState("");
  const [orKey, setOrKey] = useState("");
  const [orModel, setOrModel] = useState("");
  // step 2
  const [budget, setBudget] = useState(500);
  const [maxTradePct, setMaxTradePct] = useState(40);
  const [allowed, setAllowed] = useState<string[]>([]);
  const [maxDailyTrades, setMaxDailyTrades] = useState(10);
  const [maxDrawdownPct, setMaxDrawdownPct] = useState(15);
  const [minGate, setMinGate] = useState(0.55);
  const [intervalSec, setIntervalSec] = useState(300);
  const [execution, setExecution] = useState<"paper" | "okx">("paper");
  // step 3
  const [onFuji, setOnFuji] = useState(true);
  // model connection test
  type TestResult = { role: string; model: string; ok: boolean; ms: number; probabilities: Record<string, number> | null; choice: string | null; error: string | null };
  const [testing, setTesting] = useState(false);
  const [test, setTest] = useState<{ ok: boolean; results: TestResult[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/models").then((r) => r.json()).then((d: { options: ModelOption[] }) => {
      setOptions(d.options);
      const local = d.options.filter((o) => o.value.startsWith("ollama:"));
      setModel((m) => m || local[0]?.value || "");
      setOrModel((m) => m || d.options.find((o) => o.value.startsWith("openrouter:"))?.value || "");
    }).catch(() => null);
  }, []);

  useEffect(() => setTest(null), [source, model, orModel, orKey]);

  const local = options.filter((o) => o.value.startsWith("ollama:"));
  const openrouter = options.filter((o) => o.value.startsWith("openrouter:"));
  const primary = source === "local" ? model : orModel;
  // The second local model always gives the second opinion.
  const validator = local.find((o) => o.value !== model)?.value ?? local[0]?.value ?? "shadow";
  const maxTradeUsdt = Math.max(5, Math.round((budget * maxTradePct) / 100));
  const canNext = step === 0 ? Boolean(primary) && (source === "local" || orKey.length > 10) : step === 1 ? budget >= 10 : true;
  const lowGas = Boolean(w.address) && (w.avax ?? 0) < GAS_AVAX;
  const lowUsdc = Boolean(w.address) && (w.usdc ?? 0) < X402_USDC;
  const fujiBlocked = onFuji && (!w.address || lowGas);

  const mandate = useMemo(() => ({ allowed, maxTradeUsdt, maxDailyTrades, maxDrawdownPct, minGate }), [allowed, maxTradeUsdt, maxDailyTrades, maxDrawdownPct, minGate]);

  /** Step 1 → 2: send one real decision to the selected model(s); continue only if they answer. */
  const testAndContinue = async () => {
    setTesting(true);
    setTest(null);
    try {
      const r = await fetch("/api/models/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: primary, validator: source === "local" ? validator : undefined, openrouterKey: source === "openrouter" ? orKey : undefined }),
      });
      const j = await r.json();
      setTest(j);
      if (j.ok) setTimeout(() => setStep(1), 1200);
    } catch (e) {
      setTest({ ok: false, results: [{ role: "Bağlantı", model: primary, ok: false, ms: 0, probabilities: null, choice: null, error: (e as Error).message }] });
    } finally {
      setTesting(false);
    }
  };

  const launch = async () => {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/fleet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name || `Ajan ${Math.floor(Math.random() * 90 + 10)}`,
          model: primary,
          validator,
          openrouterKey: source === "openrouter" ? orKey : undefined,
          budget,
          execution,
          intervalSec,
          universe: 6,
          maxHoldMin: 240,
          mandate,
          launchOnFuji: onFuji,
          funding: w.mode === "browser" ? "browser" : "agentic",
          owner: w.address,
        }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      onLaunched(j.id);
      if (j.note) setLaunchNote(j.note);
      if (onFuji && w.mode === "browser") {
        // The user's own wallet funds the new agent wallet; the server waits for it.
        setLaunchNote("Cüzdanında iki işlemi onayla: gas için AVAX ve x402 için USDC.");
        await w.fund(j.wallet, GAS_AVAX, (w.usdc ?? 0) >= X402_USDC ? X402_USDC : 0);
        setLaunchNote("Fon gönderildi. Ajan Fuji'de kaydediliyor, kartından takip edebilirsin.");
      } else setLaunchNote(null);
      setStep(0);
      setName("");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-card border border-ink/50 bg-paper text-left shadow-card">
      {/* stepper */}
      <ol className="grid grid-cols-3 border-b border-ink/10">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              onClick={() => i < step && setStep(i)}
              className={`flex w-full items-center gap-2 px-4 py-3 text-left text-sm font-bold transition-colors ${i === step ? "text-ink" : i < step ? "text-ink/70 hover:text-ink" : "text-ink/35"}`}
            >
              <span className={`grid h-6 w-6 shrink-0 place-items-center rounded-full border-2 font-mono text-[11px] ${i < step ? "border-ink bg-ink text-paper" : i === step ? "border-ink bg-sun" : "border-ink/20"}`}>{i < step ? "✓" : i + 1}</span>
              <span className="truncate">{s}</span>
            </button>
          </li>
        ))}
      </ol>

      <div className="p-4">
        <AnimatePresence mode="wait">
          <motion.div key={step} initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -12 }} transition={{ duration: 0.25, ease: EASE }}>
            {step === 0 && (
              <div className="space-y-4">
                <label className="block">
                  <span className={label}>Ajan adı</span>
                  <input className={field} value={name} placeholder="ör. Atlas" onChange={(e) => setName(e.target.value)} maxLength={24} />
                </label>
                <div>
                  <span className={label}>Karar kaynağı</span>
                  <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Karar kaynağı">
                    {[
                      { v: "local" as const, t: "Yerel", sub: "Ollama · karar modelleri", d: "Tek forward pass, olasılık dağılımı döner. İnternet ve kota gerekmez.", tag: `${local.length} model kurulu` },
                      { v: "openrouter" as const, t: "OpenRouter", sub: "Bulut · ücretsiz LLM'ler", d: "Kendi API anahtarınla. LLM'den dağılım JSON olarak istenir, daha yavaş.", tag: `${openrouter.length} ücretsiz model` },
                    ].map((o) => (
                      <button
                        key={o.v}
                        role="radio"
                        aria-checked={source === o.v}
                        onClick={() => setSource(o.v)}
                        className={`rounded-btn border-2 p-4 text-left transition-colors ${source === o.v ? "border-ink bg-sun/25" : "border-ink/15 hover:border-ink/40"}`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="font-display text-2xl uppercase leading-none">{o.t}</div>
                          <span className={`h-4 w-4 shrink-0 rounded-full border-2 ${source === o.v ? "border-ink bg-ink" : "border-ink/30"}`} />
                        </div>
                        <div className="mt-1 font-mono text-[11px] text-ink/60">{o.sub}</div>
                        <p className="mt-2 text-xs text-muted">{o.d}</p>
                        <div className="mt-2 font-mono text-[10px] font-bold text-ink/70">{o.tag}</div>
                      </button>
                    ))}
                  </div>
                </div>

                {source === "local" ? (
                  <div>
                    <span className={label}>Ana model (diğer yerel model ikinci görüş verir)</span>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {local.map((o) => (
                        <button key={o.value} onClick={() => setModel(o.value)} className={`rounded-btn border-2 p-3 text-left transition-colors ${model === o.value ? "border-ink bg-ink/[0.04]" : "border-ink/15 hover:border-ink/40"}`}>
                          <div lang="en" className="font-display text-xl uppercase leading-none">{o.label}</div>
                          <div className="mt-1 text-xs text-muted">{o.note}</div>
                        </button>
                      ))}
                    </div>
                    {local.length === 0 && <p className="mt-2 text-xs text-short">Ollama'da kurulu karar modeli bulunamadı. `ollama serve` açık mı?</p>}
                  </div>
                ) : (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label>
                      <span className={label}>OpenRouter API anahtarı</span>
                      <input className={`${field} font-mono`} type="password" value={orKey} placeholder="sk-or-..." onChange={(e) => setOrKey(e.target.value)} autoComplete="off" />
                    </label>
                    <label>
                      <span className={label}>Ücretsiz model</span>
                      <select className={field} value={orModel} onChange={(e) => setOrModel(e.target.value)}>
                        {openrouter.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </label>
                  </div>
                )}
                <p className="rounded-btn bg-ink/[0.04] px-3 py-2 font-mono text-xs text-ink/70">
                  Ana model: <b className="text-ink">{primary.replace(/^(ollama|openrouter):/, "") || "-"}</b>
                  {source === "local" && (
                    <>
                      {" "}· İkinci görüş: <b className="text-ink">{validator.replace(/^ollama:/, "")}</b>
                    </>
                  )}
                </p>
                {(testing || test) && (
                  <div className="space-y-1.5 rounded-btn border border-ink/15 p-3">
                    <div className="text-xs font-bold uppercase tracking-wider text-muted">
                      {testing ? "Test kararı gönderiliyor..." : test?.ok ? "Bağlantı testi geçti" : "Bağlantı testi başarısız"}
                    </div>
                    {testing && <div className="h-1.5 overflow-hidden rounded-full bg-ink/10"><div className="h-full w-1/3 animate-pulse rounded-full bg-sun" /></div>}
                    {test?.results.map((r) => (
                      <div key={r.role} className="grid grid-cols-[18px_1fr_auto] items-center gap-2 font-mono text-xs">
                        <span className={r.ok ? "text-long" : "text-short"}>{r.ok ? "✓" : "✕"}</span>
                        <span className="min-w-0 truncate">
                          <b>{r.role}</b> · {r.model}
                          {r.ok && r.probabilities ? (
                            <span className="text-muted"> · AL {Math.round((r.probabilities.long ?? 0) * 100)}% · BEKLE {Math.round((r.probabilities.flat ?? 0) * 100)}%</span>
                          ) : (
                            <span className="text-short"> · {r.error}</span>
                          )}
                        </span>
                        <span className="text-muted">{r.ms} ms</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {step === 1 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-3">
                  <label>
                    <span className={label}>Bütçe (USDT)</span>
                    <input className={`${field} font-mono`} inputMode="decimal" value={budget} onChange={(e) => setBudget(Number(e.target.value) || 0)} />
                  </label>
                  <label>
                    <span className={label}>İşlem başı en fazla · {maxTradeUsdt} USDT</span>
                    <input type="range" min={5} max={100} step={5} value={maxTradePct} onChange={(e) => setMaxTradePct(Number(e.target.value))} className="mt-3 w-full accent-[rgb(var(--ink))]" />
                  </label>
                  <label>
                    <span className={label}>Maks. zarar (durdurma) · %{maxDrawdownPct}</span>
                    <input type="range" min={5} max={50} step={5} value={maxDrawdownPct} onChange={(e) => setMaxDrawdownPct(Number(e.target.value))} className="mt-3 w-full accent-[rgb(var(--ink))]" />
                  </label>
                </div>
                <div>
                  <span className={label}>İzinli pariteler (boş = en likit pariteler)</span>
                  <div className="flex flex-wrap gap-1.5">
                    {PAIRS.map((p) => {
                      const on = allowed.includes(p);
                      return (
                        <button key={p} onClick={() => setAllowed((a) => (on ? a.filter((x) => x !== p) : [...a, p]))} className={`min-h-[36px] rounded-btn border px-3 font-mono text-xs font-bold transition-colors ${on ? "border-ink bg-ink text-paper" : "border-ink/15 hover:border-ink"}`}>
                          {p}
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid gap-3 sm:grid-cols-4">
                  <label>
                    <span className={label}>Günlük maks. işlem</span>
                    <input className={`${field} font-mono`} inputMode="numeric" value={maxDailyTrades} onChange={(e) => setMaxDailyTrades(Number(e.target.value) || 1)} />
                  </label>
                  <label>
                    <span className={label}>Min. güven (risk kapısı) · %{Math.round(minGate * 100)}</span>
                    <input type="range" min={0.5} max={0.9} step={0.05} value={minGate} onChange={(e) => setMinGate(Number(e.target.value))} className="mt-3 w-full accent-[rgb(var(--ink))]" />
                  </label>
                  <label>
                    <span className={label}>Tur aralığı</span>
                    <select className={field} value={intervalSec} onChange={(e) => setIntervalSec(Number(e.target.value))}>
                      <option value={60}>1 dakika</option>
                      <option value={300}>5 dakika</option>
                      <option value={900}>15 dakika</option>
                    </select>
                  </label>
                  <label>
                    <span className={label}>Yürütme</span>
                    <select className={field} value={execution} onChange={(e) => setExecution(e.target.value as "paper" | "okx")}>
                      <option value="paper">Paper (canlı fiyat)</option>
                      <option value="okx">OKX demo emri</option>
                    </select>
                  </label>
                </div>
              </div>
            )}

            {step === 2 && (
              <div className="space-y-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-btn border border-ink/15 p-3 font-mono text-xs">
                    <div className="mb-2 font-sans text-xs font-bold uppercase tracking-wider text-muted">Zincire yazılacak yetki</div>
                    <dl className="grid grid-cols-2 gap-y-1">
                      <dt className="text-muted">Ana model</dt><dd className="text-right">{primary.replace(/^(ollama|openrouter):/, "")}</dd>
                      <dt className="text-muted">İkinci görüş</dt><dd className="text-right">{validator.replace(/^ollama:/, "")}</dd>
                      <dt className="text-muted">Bütçe</dt><dd className="text-right">{budget} USDT</dd>
                      <dt className="text-muted">İşlem başı</dt><dd className="text-right">≤ {maxTradeUsdt} USDT</dd>
                      <dt className="text-muted">Pariteler</dt><dd className="truncate text-right">{allowed.length ? allowed.join(", ") : "en likit 6"}</dd>
                      <dt className="text-muted">Günlük işlem</dt><dd className="text-right">≤ {maxDailyTrades}</dd>
                      <dt className="text-muted">Maks. zarar</dt><dd className="text-right">%{maxDrawdownPct}</dd>
                      <dt className="text-muted">Min. güven</dt><dd className="text-right">%{Math.round(minGate * 100)}</dd>
                    </dl>
                  </div>
                  <div className="space-y-2 rounded-btn border border-ink/15 p-3 text-xs">
                    <div className="font-bold uppercase tracking-wider text-muted">Avalanche Fuji</div>
                    <ol className="space-y-1.5 text-ink/80">
                      <li>1 · Ajana özel cüzdan açılır, {w.mode === "browser" ? "cüzdanından onayınla" : "agentic wallet'tan"} gas için AVAX gönderilir.</li>
                      <li>2 · Ajan kendi cüzdanıyla <b>ERC-8004</b> kimliği alır. Model ve yetki hash'i metadata'ya yazılır.</li>
                      <li>3 · Kendi ajanını ücretsiz kullanırsın. İstersen <b>pazara açarsın</b>; başkaları senaryo başına <b>x402</b> öder ve ajanın onlar için canlı tur çalıştırır; ödeme ajanının cüzdanına gelir.</li>
                      <li>4 · Kapanan her işlem ERC-8004 <b>itibar</b> kaydına işlenir.</li>
                    </ol>
                    <div className="rounded-btn bg-ink/[0.04] p-2">
                      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted">Fonlayan cüzdan</div>
                      {w.address ? (
                        <div className="font-mono text-[11px]">
                          {w.mode === "agentic" ? "Agentic wallet" : "Tarayıcı cüzdanı"} · {w.address.slice(0, 6)}…{w.address.slice(-4)} · {w.avax?.toFixed(3) ?? "-"} AVAX · {w.usdc?.toFixed(2) ?? "-"} USDC
                        </div>
                      ) : (
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          <button onClick={() => w.connectBrowser()} className="rounded-btn border border-ink/20 px-2.5 py-1.5 text-xs font-bold hover:border-ink">Cüzdan ile bağlan</button>
                          <button onClick={() => w.createAgentic()} className="rounded-btn bg-sun px-2.5 py-1.5 text-xs font-bold">Agentic wallet oluştur</button>
                        </div>
                      )}
                    </div>
                    {lowGas && <p className="font-semibold text-short">Cüzdanda yeterli Fuji AVAX yok (en az {GAS_AVAX}). Sağ üstteki menüden faucet'e git.</p>}
                    {!lowGas && lowUsdc && <p className="font-semibold text-orange-600">Cüzdanda USDC az: x402 ödemeleri için Circle faucet'ten Fuji USDC al.</p>}
                  </div>
                </div>
                {isPublic ? (
                  <p className="rounded-btn bg-ink/[0.04] px-3 py-2 text-xs text-muted">Herkese açık demoda ajanlar zincir kaydı olmadan çalışır. Fuji kaydını sunum makinesinden canlı gösteriyoruz.</p>
                ) : (
                  <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold">
                    <input type="checkbox" checked={onFuji} onChange={(e) => setOnFuji(e.target.checked)} className="h-4 w-4 accent-[rgb(var(--ink))]" />
                    Fuji'ye kaydet (ERC-8004 kimlik ve itibar)
                  </label>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          {step > 0 && (
            <button onClick={() => setStep((s) => s - 1)} className="min-h-[44px] rounded-btn border border-ink/20 px-4 text-sm font-bold hover:border-ink">
              ← Geri
            </button>
          )}
          {err && <span className="text-sm text-short">{err}</span>}
          {launchNote && <span className="text-sm text-ink/70">{launchNote}</span>}
          {step < 2 ? (
            <button
              onClick={() => (step === 0 ? testAndContinue() : setStep((s) => s + 1))}
              disabled={!canNext || testing}
              className="ml-auto min-h-[44px] rounded-btn bg-ink px-5 text-sm font-bold text-paper transition-transform hover:-translate-y-px disabled:opacity-40"
            >
              {step === 0 ? (testing ? "Test ediliyor..." : test && !test.ok ? "Tekrar test et →" : "Test et ve devam →") : "Devam →"}
            </button>
          ) : (
            <button onClick={launch} disabled={busy || fujiBlocked} title={fujiBlocked ? "Önce cüzdan bağla ve Fuji AVAX ile doldur" : undefined} className="ml-auto min-h-[44px] rounded-btn border border-ink/10 bg-sun px-5 font-bold shadow-btn transition-transform hover:-translate-y-px disabled:opacity-60">
              {busy ? "Fırlatılıyor..." : onFuji ? "Fuji'ye fırlat →" : "Ajanı başlat →"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
