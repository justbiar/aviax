"use client";

import { useMemo, useState } from "react";

/**
 * Pricing model: x402 per decision cycle (paid win or lose, covers model cost) plus a
 * success fee on new profit only (high-water mark). Platform profit with a linear
 * adoption curve A(f) = 1 - f/F is maximised at f* = F/2 - N(p - c) / (2 E[P+]).
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
  const [price, setPrice] = useState(0.001); // x402 per cycle, USDC
  const [cost, setCost] = useState(0.0005); // model + settlement per cycle, USD
  const [F, setF] = useState(40); // fee at which adoption reaches zero, %

  const m = useMemo(() => {
    const N = Math.round((30 * 24 * 60) / intervalMin);
    const z = mu / sigma;
    const ePos = budget * ((sigma / 100) * phi(z) + (mu / 100) * Phi(z)); // E[max(P,0)] per month
    const cycleMargin = N * (price - cost);
    const fStar = Math.min(F / 100, Math.max(0, F / 200 - cycleMargin / (2 * ePos)));
    const breakEvenNoX402 = (N * cost) / ePos; // fee needed if the platform absorbed model cost
    const platform = fStar * ePos + cycleMargin;
    const userCycles = N * price;
    const userNet = budget * (mu / 100) - fStar * ePos - userCycles;
    return { N, ePos, fStar, breakEvenNoX402, platform, userCycles, userNet };
  }, [budget, mu, sigma, intervalMin, price, cost, F]);

  const usd = (v: number, d = 2) => `$${v.toFixed(d)}`;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_1.1fr]">
      <div className="space-y-3 rounded-card border border-ink/15 bg-paper p-5 shadow-card">
        <div className="text-xs font-bold uppercase tracking-wider text-muted">Varsayımlar (aylık, ajan başına)</div>
        <Slider label="Ajan bütçesi" value={budget} min={100} max={10000} step={100} fmt={(v) => `${v} USDT`} onChange={setBudget} />
        <Slider label="Beklenen getiri" value={mu} min={-2} max={8} step={0.5} fmt={(v) => `%${v}`} onChange={setMu} />
        <Slider label="Volatilite" value={sigma} min={1} max={20} step={0.5} fmt={(v) => `%${v}`} onChange={setSigma} />
        <Slider label="Tur aralığı" value={intervalMin} min={1} max={60} step={1} fmt={(v) => `${v} dk`} onChange={setIntervalMin} />
        <Slider label="x402 fiyatı (karar turu başına)" value={price} min={0} max={0.01} step={0.0005} fmt={(v) => `${v.toFixed(4)} USDC`} onChange={setPrice} />
        <Slider label="Model + settle maliyeti (tur başına)" value={cost} min={0} max={0.005} step={0.0001} fmt={(v) => usd(v, 4)} onChange={setCost} />
        <Slider label="Benimsemenin sıfırlandığı ücret (F)" value={F} min={20} max={60} step={1} fmt={(v) => `%${v}`} onChange={setF} />
      </div>

      <div className="space-y-3">
        <div className="rounded-card border-2 border-ink bg-sun/25 p-5 shadow-brut">
          <div className="text-xs font-bold uppercase tracking-wider">Optimal başarı ücreti</div>
          <div className="font-display text-7xl leading-none">%{(m.fStar * 100).toFixed(1)}</div>
          <p className="mt-2 font-mono text-xs">f* = F/2 − N·(p − c) / (2·E[kâr⁺])</p>
          <p className="mt-1 text-sm">Sadece yeni kârdan (high-water mark). Zarar eden ajandan ücret yok; model maliyeti her iki senaryoda x402 ile karşılanır.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            ["Aylık karar turu (N)", m.N.toLocaleString("tr-TR")],
            ["Beklenen pozitif kâr E[kâr⁺]", usd(m.ePos)],
            ["Kullanıcının x402 ödemesi", usd(m.userCycles)],
            ["x402 olmasaydı başa baş ücret", `%${(m.breakEvenNoX402 * 100).toFixed(1)}`],
            ["Platform geliri (ajan başına)", usd(m.platform)],
            ["Kullanıcının net beklenen getirisi", usd(m.userNet)],
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
