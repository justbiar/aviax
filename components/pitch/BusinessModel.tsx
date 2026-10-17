"use client";

import { useMemo, useState } from "react";

/**
 * Pricing model. Own agents: no per-cycle charge, the platform carries model cost c and
 * takes a success fee on new profit only (high-water mark). With a linear adoption curve
 * A(f) = 1 - f/F, platform profit A(f)(f E[P+] - N c) peaks at f* = F/2 + N c / (2 E[P+]).
 * Marketplace: listed agents sell signals over x402; the platform keeps a take rate.
 */

const phi = (x: number) => Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
const Phi = (x: number) => {
  // Abramowitz-Stegun approximation of the standard normal CDF
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = phi(x) * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - d : d;
};

function Slider({ label, value, min, max, step, fmt, onChange }: { label: string; value: number; min: number; max: number; step: number; fmt: (v: number) => string; onChange: (v: number) => void }) {
  return (
    <label className="block">
      <span className="mb-1 flex justify-between text-xs font-semibold text-muted">
        <span>{label}</span>
        <span className="font-mono text-ink num">{fmt(value)}</span>
      </span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-[rgb(var(--ink))]" />
    </label>
  );
}

export function BusinessModel() {
  const [budget, setBudget] = useState(1000);
  const [mu, setMu] = useState(2); // monthly mean return %
  const [sigma, setSigma] = useState(6); // monthly volatility %
  const [intervalMin, setIntervalMin] = useState(15);
  const [cost, setCost] = useState(0.0005); // model inference per cycle, USD (carried by the platform)
  const [signalPrice, setSignalPrice] = useState(0.01); // marketplace x402 price per signal
  const [buyers, setBuyers] = useState(500); // signal purchases per month
  const [take, setTake] = useState(10); // platform take rate on signal sales, %
  const [F, setF] = useState(40); // fee at which adoption reaches zero, %

  const m = useMemo(() => {
    const N = Math.round((30 * 24 * 60) / intervalMin);
    const z = mu / sigma;
    const ePos = budget * ((sigma / 100) * phi(z) + (mu / 100) * Phi(z)); // E[max(P,0)] per month
    const modelCost = N * cost;
    const fStar = Math.min(F / 100, Math.max(0, F / 200 + modelCost / (2 * ePos)));
    const breakEven = modelCost / ePos; // fee that just covers model cost
    const ownPlatform = fStar * ePos - modelCost;
    const userNet = budget * (mu / 100) - fStar * ePos;
    const sales = signalPrice * buyers;
    const marketPlatform = (sales * take) / 100;
    const ownerSignalIncome = sales - marketPlatform;
    return { N, ePos, fStar, breakEven, modelCost, ownPlatform, userNet, sales, marketPlatform, ownerSignalIncome };
  }, [budget, mu, sigma, intervalMin, cost, F, signalPrice, buyers, take]);

  const usd = (v: number, d = 2) => `$${v.toFixed(d)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-3 rounded-card border border-ink/15 bg-paper p-5 shadow-card">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">Varsayımlar (aylık, ajan başına)</div>
        <Slider label="Ajan bütçesi" value={budget} min={100} max={10000} step={100} fmt={(v) => `${v} USDT`} onChange={setBudget} />
        <Slider label="Beklenen getiri" value={mu} min={-2} max={8} step={0.5} fmt={(v) => `%${v}`} onChange={setMu} />
        <Slider label="Volatilite" value={sigma} min={1} max={20} step={0.5} fmt={(v) => `%${v}`} onChange={setSigma} />
        <Slider label="Tur aralığı" value={intervalMin} min={1} max={60} step={1} fmt={(v) => `${v} dk`} onChange={setIntervalMin} />
        <Slider label="Model maliyeti (tur başına, platform öder)" value={cost} min={0} max={0.005} step={0.0001} fmt={(v) => usd(v, 4)} onChange={setCost} />
        <Slider label="Benimsemenin sıfırlandığı ücret (F)" value={F} min={20} max={60} step={1} fmt={(v) => `%${v}`} onChange={setF} />
        <div className="pt-2 text-xs font-bold uppercase tracking-wider text-muted">Pazar (x402 sinyal satışı)</div>
        <Slider label="Sinyal fiyatı" value={signalPrice} min={0.001} max={0.1} step={0.001} fmt={(v) => `${v.toFixed(3)} USDC`} onChange={setSignalPrice} />
        <Slider label="Aylık sinyal alımı" value={buyers} min={0} max={10000} step={100} fmt={(v) => v.toLocaleString("tr-TR")} onChange={setBuyers} />
        <Slider label="Platform payı" value={take} min={0} max={30} step={1} fmt={(v) => `%${v}`} onChange={setTake} />
      </div>

      <div className="space-y-3">
        <div className="rounded-card border-2 border-ink bg-sun/25 p-5 shadow-brut">
          <div className="text-xs font-bold uppercase tracking-wider">Optimal başarı ücreti</div>
          <div className="font-display text-7xl leading-none">%{(m.fStar * 100).toFixed(1)}</div>
          <p className="mt-2 font-mono text-xs">f* = F/2 + N·c / (2·E[kâr⁺])</p>
          <p className="mt-1 text-sm">Kendi ajanın için tur ücreti yok. Sadece yeni kârdan (high-water mark) ücret alınır; zarar eden ajandan alınmaz. Model maliyetini iki senaryoda da platform taşır, ücret bunu karşılayacak şekilde optimize edilir.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Aylık karar turu (N)", m.N.toLocaleString("tr-TR")],
            ["Beklenen pozitif kâr E[kâr⁺]", usd(m.ePos)],
            ["Platformun model maliyeti", usd(m.modelCost)],
            ["Başa baş ücret", `%${(m.breakEven * 100).toFixed(1)}`],
            ["Platform net (kendi ajanlar)", usd(m.ownPlatform)],
            ["Kullanıcının net beklenen getirisi", usd(m.userNet)],
            ["Sahibin sinyal geliri (x402)", usd(m.ownerSignalIncome)],
            ["Platform payı (pazar)", usd(m.marketPlatform)],
          ].map(([k, v]) => (
            <div key={k} className="rounded-card border border-ink/15 bg-paper p-3 shadow-card">
              <div className="text-[11px] font-semibold text-muted">{k}</div>
              <div className="font-mono text-xl font-bold num">{v}</div>
            </div>
          ))}
        </div>
        <p className="text-xs text-muted">
          Benimseme ücretle doğrusal düşer: A(f) = 1 − f/F. Aylık getiri normal dağılım (μ, σ) ile modellenir. Rakamlar varsayımlara bağlı bir tahmindir.
        </p>
      </div>
    </div>
  );
}
