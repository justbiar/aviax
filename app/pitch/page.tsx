"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { LlmVsDecision } from "@/components/agent/LlmVsDecision";
import { ModelCompare } from "@/components/pitch/ModelCompare";
import { BusinessModel } from "@/components/pitch/BusinessModel";

const EASE = [0.22, 1, 0.36, 1] as const;
const reveal = {
  initial: { opacity: 0, y: 24 },
  whileInView: { opacity: 1, y: 0 },
  viewport: { once: true, amount: 0.4 },
  transition: { duration: 0.7, ease: EASE },
};

const DECISIONS = [
  { q: "Hangi parite?", type: "choice", out: "N pariteye dağılım", ex: "SOL 34% · ETH 18% · AVAX 14%" },
  { q: "Şimdi alınır mı?", type: "choice", out: "al / USDT'de bekle", ex: "AL 66% · BEKLE 34%" },
  { q: "Ne kadar?", type: "score", out: "bütçenin 5 seviyesi", ex: "Medium (2.4 / 4)" },
  { q: "TP / SL nerede?", type: "choice", out: "ATR katlarına dağılım", ex: "TP 2 ATR · SL 1 ATR" },
  { q: "İşleme girilsin mi?", type: "noul + choice", out: "p(kurulum) · p(al)", ex: "0.71 → EXECUTE" },
];

const FLOW = [
  { k: "OKX ATK", d: "market_get_tickers · candles · funding", c: "bg-paper" },
  { k: "Özellikler", d: "trend · RSI · ATR · hacim z · funding", c: "bg-paper" },
  { k: "2 karar modeli", d: "ana model ∥ ikinci görüş, parite başına 2 forward pass", c: "bg-sun" },
  { k: "Ensemble", d: "0.6 ana + 0.4 ikinci görüş", c: "bg-paper" },
  { k: "Risk kapısı", d: "noul ≥ 0.55 ve iki model hemfikir", c: "bg-paper" },
  { k: "OKX ATK", d: "spot_place_order + OCO TP/SL", c: "bg-ink text-paper" },
];

export default function PitchPage() {
  const root = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    const slides = () => Array.from(root.current?.querySelectorAll<HTMLElement>("[data-slide]") ?? []);
    const io = new IntersectionObserver((es) => es.forEach((e) => e.isIntersecting && setIdx(slides().indexOf(e.target as HTMLElement))), { threshold: 0.3 });
    slides().forEach((s) => io.observe(s));
    const onKey = (e: KeyboardEvent) => {
      const list = slides();
      const cur = list.findIndex((s) => Math.abs(s.getBoundingClientRect().top) < window.innerHeight / 2);
      if (["ArrowDown", "ArrowRight", "PageDown", " "].includes(e.key)) {
        e.preventDefault();
        list[Math.min(list.length - 1, cur + 1)]?.scrollIntoView({ behavior: "smooth" });
      }
      if (["ArrowUp", "ArrowLeft", "PageUp"].includes(e.key)) {
        e.preventDefault();
        list[Math.max(0, cur - 1)]?.scrollIntoView({ behavior: "smooth" });
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      io.disconnect();
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  const slide = "relative flex min-h-[calc(100vh-64px)] snap-start items-center border-b border-ink/10 px-4 py-16 sm:px-8";
  const wrap = "mx-auto w-full max-w-[1100px]";
  const kicker = "font-mono text-xs font-bold uppercase tracking-[0.2em] text-muted";
  const h2 = "mt-3 font-display text-5xl uppercase leading-[0.95] sm:text-7xl";

  return (
    <div ref={root} className="h-[calc(100vh-64px)] snap-y snap-mandatory overflow-y-auto">
      <div className="pointer-events-none fixed bottom-4 right-4 z-30 rounded-full border border-ink/15 bg-paper px-3 py-1 font-mono text-xs shadow-btn">
        {String(idx + 1).padStart(2, "0")} / 10
      </div>

      {/* 1 · title */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={`${wrap} text-center`}>
          <motion.span {...reveal} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-bold shadow-btn">
            <span className="h-2 w-2 rounded-full bg-sun" /> Team1 Agentic Hackathon · Ankara · 17 Ekim 2026
          </motion.span>
          <motion.h1 {...reveal} className="mt-6 font-display text-[64px] uppercase leading-[0.9] sm:text-[120px]">
            Tahmin eden
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">agent.</span>
              <span className="absolute inset-x-[-8px] bottom-2 z-0 h-[36%] bg-sun" />
            </span>
          </motion.h1>
          <motion.p {...reveal} className="mx-auto mt-6 max-w-[640px] text-xl font-medium text-ink/75">
            Aviax, OKX Agent Trade Kit üzerinde çalışan otonom bir trading agent. Kararlarını metin üreterek değil, iki karar modelinden (strands-decider ve laya) gelen olasılık dağılımlarıyla veriyor.
          </motion.p>
        </div>
      </section>

      {/* 2 · problem */}
      <section data-slide className={slide}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>01 · Problem</motion.div>
          <motion.h2 {...reveal} className={h2}>
            LLM ajanları komut izler.
            <br />
            Karar anında yazar.
          </motion.h2>
          <div className="mt-10 grid gap-3 sm:grid-cols-3">
            {[
              { n: "Komut", t: "LLM ajanı talimat ve araç çerçevesinde iyi çalışır: plan kurar, API çağırır. Ama \"al mı bekle mi\" sorusuna metin yazar." },
              { n: "4–108 sn", t: "Bizim ölçümümüz: ücretsiz LLM'lerle tek bir karar turu. Her istekte farklı modele yönlendirme, 429 kota." },
              { n: "Parse", t: "Metni JSON'a çevir, doğrula, boş geleni tekrar sor. \"Bence long\" bir risk eşiğine doğrudan bağlanamaz." },
            ].map((c, i) => (
              <motion.div key={c.n} {...reveal} transition={{ ...reveal.transition, delay: i * 0.08 }} className="rounded-card border border-ink/15 bg-paper p-5 shadow-card">
                <div className="font-display text-5xl">{c.n}</div>
                <p className="mt-2 text-ink/70">{c.t}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 3 · insight */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>02 · İçgörü</motion.div>
          <motion.h2 {...reveal} className={h2}>
            Trade kararı bir
            <br />
            <span className="bg-sun px-2">sınıflandırma</span> problemi.
          </motion.h2>
          <motion.p {...reveal} className="mt-5 max-w-[720px] text-lg text-ink/75">
            Karar modelleri metin üretmez: verilen seçeneklerin her birine tek bir forward pass ile olasılık verir. Yerelde iki tane çalıştırıyoruz, strands-decider (2B) ana karar verici, laya (421M) ikinci görüş. Trading&apos;in her adımını bu tür bir soruya çevirdik.
          </motion.p>
          <motion.div {...reveal} className="mt-8">
            <LlmVsDecision />
          </motion.div>
          <motion.div {...reveal} className="mt-6">
            <ModelCompare />
          </motion.div>
          <motion.p {...reveal} className="mt-4 text-sm text-muted">
            İkisi rakip değil: LLM'i yapabildiği işte (açıklama, anlatım, isteğe bağlı OpenRouter seçeneği) tutuyoruz, kararı karar modeline veriyoruz.
          </motion.p>
        </div>
      </section>

      {/* 4 · six decisions */}
      <section data-slide className={slide}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>03 · Nasıl çalışıyor</motion.div>
          <motion.h2 {...reveal} className={h2}>Beş karar, beş dağılım.</motion.h2>
          <div className="mt-8 overflow-hidden rounded-card border border-ink/15 bg-paper shadow-card">
            {DECISIONS.map((d, i) => (
              <motion.div key={d.q} {...reveal} transition={{ ...reveal.transition, delay: i * 0.06 }} className="grid grid-cols-[1fr_auto] items-center gap-3 border-b border-ink/10 px-5 py-4 last:border-0 sm:grid-cols-[1.2fr_110px_1fr_1.2fr]">
                <span className="text-lg font-bold">{d.q}</span>
                <span className="justify-self-end rounded-full border border-ink/20 px-2.5 py-0.5 font-mono text-xs font-bold sm:justify-self-start">{d.type}</span>
                <span className="hidden text-ink/60 sm:block">{d.out}</span>
                <span className="col-span-2 font-mono text-sm sm:col-span-1">{d.ex}</span>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* 5 · architecture */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>04 · Mimari</motion.div>
          <motion.h2 {...reveal} className={h2}>ATK&apos;dan ATK&apos;ya.</motion.h2>
          <div className="mt-10 grid gap-3 md:grid-cols-6">
            {FLOW.map((f, i) => (
              <motion.div key={f.k + i} {...reveal} transition={{ ...reveal.transition, delay: i * 0.09 }} className={`relative rounded-card border-2 border-ink p-4 shadow-brut ${f.c}`}>
                <div className="font-mono text-[10px] font-bold opacity-60">{String(i + 1).padStart(2, "0")}</div>
                <div className="mt-1 font-display text-2xl uppercase leading-none">{f.k}</div>
                <p className="mt-2 text-xs leading-snug opacity-75">{f.d}</p>
                {i < FLOW.length - 1 && <span className="absolute -right-3 top-1/2 z-10 hidden -translate-y-1/2 font-bold md:block">→</span>}
              </motion.div>
            ))}
          </div>
          <motion.div {...reveal} className="mt-5 rounded-card border border-dashed border-ink/30 bg-paper p-4 text-sm text-ink/70">
            <b className="text-ink">Yan kol · OpenRouter LLM:</b> sadece anlatıcı. Dağılımları Türkçe açıklıyor, hiçbir karara oy vermiyor. Karar zinciri LLM olmadan da çalışıyor.
          </motion.div>
        </div>
      </section>

      {/* 6 · safety */}
      <section data-slide className={slide}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>05 · Güvenlik</motion.div>
          <motion.h2 {...reveal} className={h2}>Olasılık varsa, kural da var.</motion.h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            {[
              ["İki model hemfikir olmalı", "Risk kapısı iki ifadeyle iki modele sorulur. Ensemble yetkideki min. güveni geçmeli; bir model %35'in altındaysa veto eder. Aksi halde HOLD."],
              ["Bekle bir seçenek", "Model \"işlem yok\" diyebiliyor. Bekle en olası sonuçsa ajan USDT'de kalıyor."],
              ["Bütçe tavanı", "Her ajanın kendi USDT bütçesi var. Spot, kaldıraç yok; model alımı bütçenin içinde ölçekliyor."],
              ["Her alım OCO ile", "Alımdan hemen sonra ATK ile TP ve SL içeren OCO satış emri. Korumasız pozisyon yok."],
            ].map(([t, d], i) => (
              <motion.div key={t} {...reveal} transition={{ ...reveal.transition, delay: i * 0.07 }} className="rounded-card border border-ink/15 bg-paper p-5 shadow-card">
                <div className="text-lg font-bold">{t}</div>
                <p className="mt-1 text-ink/70">{d}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* business model */}
      <section data-slide className={slide}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>06 · İş modeli</motion.div>
          <motion.h2 {...reveal} className={h2}>
            Tahmin tutarsa
            <br />
            <span className="bg-sun px-2">kazanırız.</span>
          </motion.h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Kendi ajanın: sadece kârdan", "Kendi ajanını ücretsiz kullanırsın. Zarar eden ajandan ücret yok; sadece high-water mark üstündeki yeni kârdan başarı ücreti alınır. Model maliyetini iki durumda da platform taşır."],
              ["Pazar: x402 ile senaryo", "Ajanını pazara açarsan fiyatı sen koyarsın. Başka kullanıcılar ve ajanlar senaryo başına x402 öder; ajan onlar için canlı bir karar turu çalıştırır. USDC ajanının cüzdanına gelir, platform pay alır."],
              ["Prediction market mantığı", "Alıcılar, ERC-8004 itibar geçmişi kalibre tahmin üreten ajanları seçer. İyi tahmin eden ajan daha çok satar: tahmin kalitesi gelire dönüşür."],
            ].map(([t, d], i) => (
              <motion.div key={t} {...reveal} transition={{ ...reveal.transition, delay: i * 0.07 }} className="rounded-card border border-ink/15 bg-paper p-5 shadow-card">
                <div className="text-lg font-bold">{t}</div>
                <p className="mt-1 text-sm text-ink/70">{d}</p>
              </motion.div>
            ))}
          </div>
          <motion.div {...reveal} className="mt-6">
            <BusinessModel />
          </motion.div>
        </div>
      </section>

      {/* avalanche + okx */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>07 · Neden Avalanche, neden OKX</motion.div>
          <motion.h2 {...reveal} className={h2}>Zincirde güven, borsada işlem.</motion.h2>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <motion.div {...reveal} className="rounded-card border-2 border-ink bg-paper p-5 shadow-brut">
              <div className="font-display text-3xl uppercase">Avalanche Fuji</div>
              <ul className="mt-3 space-y-2 text-sm text-ink/80">
                <li><b>ERC-8004 kimlik:</b> her ajan kendi cüzdanıyla kaydolur; model ve yetki hash'i metadata'da.</li>
                <li><b>x402 pazar:</b> pazara açılan ajanın senaryosu USDC ile (EIP-3009) başlatılır; ödeme ajanın cüzdanına. Hızlı kesinleşme, ödemeden hemen sonra turun başlamasını sağlar.</li>
                <li><b>İtibar:</b> kapanan her işlem PnL ile Reputation Registry'ye yazılır; kalibrasyon herkesçe denetlenir.</li>
              </ul>
            </motion.div>
            <motion.div {...reveal} className="rounded-card border-2 border-ink bg-paper p-5 shadow-brut">
              <div className="font-display text-3xl uppercase">OKX</div>
              <ul className="mt-3 space-y-2 text-sm text-ink/80">
                <li><b>Agent Trade Kit:</b> piyasa taraması, mumlar, spot emir ve OCO TP/SL ATK'nın MCP araçlarıyla.</li>
                <li><b>OKX.AI servisi:</b> her pazar ajanı x402 ile ücretli bir senaryo API'si; başka ajanlar ve servisler çağırabilir.</li>
                <li><b>Demo hesap:</b> trade ekranı OKX demo ile aynı davranır.</li>
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 7 · demo */}
      <section data-slide className={`${slide} bg-stage text-white`}>
        <div className={`${wrap} text-center`}>
          <motion.div {...reveal} className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/50">08 · Canlı demo</motion.div>
          <motion.h2 {...reveal} className="mt-3 font-display text-6xl uppercase leading-[0.95] sm:text-8xl">
            İzleyin,
            <br />
            <span className="text-sun">karar versin.</span>
          </motion.h2>
          <motion.div {...reveal} className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/agent" className="inline-flex min-h-[52px] items-center rounded-btn bg-sun px-6 text-lg font-bold text-black shadow-btn transition-transform hover:-translate-y-px">
              Agent&apos;ı aç →
            </Link>
            <Link href="/trade" className="inline-flex min-h-[52px] items-center rounded-btn border border-white/30 px-6 text-lg font-bold transition-colors hover:bg-white hover:text-black">
              Trade ekranı
            </Link>
          </motion.div>
          <motion.div {...reveal} className="mx-auto mt-12 max-w-[900px] text-left">
            <LlmVsDecision dark />
          </motion.div>
        </div>
      </section>

      {/* 8 · next */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>09 · Sırada ne var</motion.div>
          <motion.h2 {...reveal} className={h2}>
            Doğrulanabilir
            <br />
            <span className="bg-sun px-2">tahmin geçmişi.</span>
          </motion.h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Avalanche · canlı", "Her ajan Fuji'de ERC-8004 kimliği alıyor, yetki hash'i zincirde. Karar turları x402 ile ödeniyor, kapanan işlemler itibar kaydına işleniyor."],
              ["Fine-tune LAYA", "Açık kaynak LAYA'yı kendi trade sonuçlarımızla eğit. Kalibrasyon her gün iyileşsin."],
              ["Kalibrasyon paneli", "Tahmin edilen olasılık ile gerçekleşen sonuç: Brier skoru ve güvenilirlik eğrisi."],
            ].map(([t, d], i) => (
              <motion.div key={t} {...reveal} transition={{ ...reveal.transition, delay: i * 0.08 }} className="rounded-card border border-ink/15 bg-paper p-5 shadow-card">
                <div className="font-display text-3xl uppercase">{t}</div>
                <p className="mt-2 text-ink/70">{d}</p>
              </motion.div>
            ))}
          </div>
          <motion.p {...reveal} className="mt-12 font-display text-4xl uppercase">Aviax · LLM&apos;ler yazar, karar modelleri karar verir.</motion.p>
        </div>
      </section>
    </div>
  );
}
