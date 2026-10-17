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

const RISK_DECISIONS = [
  { q: "Hangi masa?", type: "choice", out: "risk · portföy · hazine · yönetişim", ex: "RİSK 95%" },
  { q: "Müdahale gerekli mi?", type: "choice", out: "evet / hayır / kararsız", ex: "EVET 82% · 68%" },
  { q: "Risk seviyesi?", type: "choice", out: "düşük · yükselmiş · kritik", ex: "KRİTİK 87%" },
  { q: "Hangi aksiyon, ne kadar?", type: "choice", out: "koru · dengele · azalt · çık + stable payı", ex: "DENGELE · %10" },
  { q: "Limit ihlali var mı?", type: "noul", out: "olgusal kontrol, kuralla kıyaslanır", ex: "0.91 → kural ile uyumlu" },
];

const FLOW = [
  { k: "OKX ATK", d: "tickers · candles · bakiye (MCP araçları)", c: "bg-paper" },
  { k: "Kod ölçer", d: "özellikler, limitler, VaR, emir boyutu", c: "bg-paper" },
  { k: "Decision layer", d: "/api/decision · MCP aviax_decide · { state, questions }", c: "bg-sun" },
  { k: "2 karar modeli", d: "ana ∥ ikinci görüş, soru başına 1 forward pass, ensemble 0.6/0.4", c: "bg-paper" },
  { k: "Yönetişim", d: "uyum + güven + model↔kural; tartışmalıysa insan", c: "bg-paper" },
  { k: "OKX ATK", d: "spot_place_order (+ OCO) · Fuji ERC-8004 kayıt", c: "bg-ink text-paper" },
];

export default function PitchPage() {
  const root = useRef<HTMLDivElement>(null);
  const [idx, setIdx] = useState(0);
  const [count, setCount] = useState(0);
  useEffect(() => setCount(root.current?.querySelectorAll("[data-slide]").length ?? 0), []);

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
        {String(idx + 1).padStart(2, "0")} / {String(count || 11).padStart(2, "0")}
      </div>

      {/* 1 · title */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={`${wrap} text-center`}>
          <motion.span {...reveal} className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1.5 text-xs font-bold shadow-btn">
            <span className="h-2 w-2 rounded-full bg-sun" /> Team1 Agentic Hackathon · Ankara · 17 Ekim 2026
          </motion.span>
          <motion.h1 {...reveal} className="mt-6 font-display text-[64px] uppercase leading-[0.9] sm:text-[120px]">
            Karar veren
            <br />
            <span className="relative inline-block">
              <span className="relative z-10">katman.</span>
              <span className="absolute inset-x-[-8px] bottom-2 z-0 h-[36%] bg-sun" />
            </span>
          </motion.h1>
          <motion.p {...reveal} className="mx-auto mt-6 max-w-[700px] text-xl font-medium text-ink/75">
            Aviax, OKX AI ajanları için bir karar katmanı. Kararlar metinden değil, iki karar modelinin (strands-decider ve laya) olasılık dağılımlarından geliyor. Aynı katman iki işte canlı: otonom trade ajanı ve şirket risk masası.
          </motion.p>
          <motion.div {...reveal} className="mt-6 flex flex-wrap justify-center gap-2 font-mono text-xs">
            {["OKX Agent Trade Kit", "Avalanche Fuji · ERC-8004 · x402", "yerel karar modelleri", "otonom yürütme"].map((t) => (
              <span key={t} className="rounded-full border border-ink/15 bg-paper px-3 py-1">{t}</span>
            ))}
          </motion.div>
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
              { n: "Onay", t: "Diğer uç: her öneriyi insana sormak. O zaman karar insanındır, ajan sadece bir rapor yazarıdır. Kurumlar ölçülebilir, denetlenebilir otonomi istiyor." },
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
          <motion.h2 {...reveal} className={h2}>Bir katman, iki iş.</motion.h2>
          <motion.p {...reveal} className="mt-4 max-w-[760px] text-lg text-ink/75">
            Her adım bir soru, her cevap bir olasılık dağılımı. Aynı <span className="font-mono text-base">{"{ state, questions }"}</span> sözleşmesi trade ajanında da şirket hazinesinde de çalışıyor.
          </motion.p>
          <div className="mt-6 grid gap-4 lg:grid-cols-2">
            {([["Trade ajanı", DECISIONS], ["Şirket risk masası", RISK_DECISIONS]] as const).map(([title, rows]) => (
              <div key={title} className="overflow-hidden rounded-card border border-ink/15 bg-paper shadow-card">
                <div className="border-b border-ink/10 bg-sun/30 px-5 py-2.5 font-display text-xl uppercase">{title}</div>
                {rows.map((d, i) => (
                  <motion.div key={d.q} {...reveal} transition={{ ...reveal.transition, delay: i * 0.05 }} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 border-b border-ink/10 px-5 py-3 last:border-0">
                    <span className="font-bold">{d.q}</span>
                    <span className="justify-self-end rounded-full border border-ink/20 px-2 py-0.5 font-mono text-[11px] font-bold">{d.type}</span>
                    <span className="text-sm text-ink/60">{d.out}</span>
                    <span className="justify-self-end font-mono text-xs">{d.ex}</span>
                  </motion.div>
                ))}
              </div>
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

      {/* risk desk, live */}
      <section data-slide className={`${slide} bg-stage text-white`}>
        <div className={wrap}>
          <motion.div {...reveal} className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-sun">05 · Şirket risk masası · canlı</motion.div>
          <motion.h2 {...reveal} className="mt-3 font-display text-5xl uppercase leading-[0.95] sm:text-7xl">
            Model karar verir.
            <br />
            Kod sınırlar. <span className="text-sun">OKX uygular.</span>
          </motion.h2>
          <motion.p {...reveal} className="mt-4 max-w-[780px] text-lg text-white/70">
            Aviax Yapım İşleri LTD ŞTİ&apos;nin OKX demo hazinesi 10 saniyede bir okunur. Limitleri kod ölçer; müdahale kararını iki model verir. Karar tartışmasızsa emirler kademeli olarak OKX&apos;e gider; sadece tartışmalı karar insana düşer.
          </motion.p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {[
              ["%77,9 → %37,8", "BTC yoğunlaşması", "politika üst sınırı %40, kapandı"],
              ["%8,7 → %49", "stable + nakit rezervi", "alt limit %20, kapandı"],
              ["%82 · %68", "iki modelin müdahale oyu", "uyum %90, insan onayı gerekmedi"],
              ["KORU", "limitler kapanınca", "modeller kendisi durdu, satış bitti"],
            ].map(([big, t, d], i) => (
              <motion.div key={t} {...reveal} transition={{ ...reveal.transition, delay: i * 0.07 }} className="rounded-card border border-white/10 bg-white/[0.04] p-5">
                <div className="font-display text-4xl text-sun">{big}</div>
                <div className="mt-2 font-bold">{t}</div>
                <p className="mt-1 font-mono text-xs text-white/55">{d}</p>
              </motion.div>
            ))}
          </div>
          <motion.div {...reveal} className="mt-6 grid gap-3 md:grid-cols-3">
            {[
              ["Oylama geçmişi", "Her turda her modelin oyu, ortak karar, kural kontrolü ve sonraki turdaki portföy değeri kayıtlı."],
              ["Model karnesi", "Kural doğruluğu (modelin \"ihlal var\" cevabı ölçülen ihlalle örtüşüyor mu): 137 turda strands-decider %100, laya %64. Kime güveneceğini veri seçer."],
              ["Gerçek sınır", "OKX TR, OKB'yi uyum kuralı nedeniyle işleme kapatıyor; masa reddedilen pariteyi hatırlayıp planı diğer varlıklarla kuruyor."],
            ].map(([t, d], i) => (
              <motion.div key={t} {...reveal} transition={{ ...reveal.transition, delay: i * 0.06 }} className="rounded-card border border-white/10 p-4">
                <div className="font-display text-xl uppercase">{t}</div>
                <p className="mt-1 text-sm text-white/60">{d}</p>
              </motion.div>
            ))}
          </motion.div>
        </div>
      </section>

      {/* 6 · safety */}
      <section data-slide className={slide}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>06 · Otonomi ve güvenlik</motion.div>
          <motion.h2 {...reveal} className={h2}>Olasılık varsa, kural da var.</motion.h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["İnsan sadece tartışmada", "Modeller anlaşmazsa, güven %55 altındaysa, model kuralla çelişirse veya karar tam çıkışsa insan onayı. Gerisini model uygular."],
              ["Kademeli yürütme", "Büyük düzeltme tek seferde değil: tur başına otonom limit kadar, kalan sonraki turlarda yeniden değerlendirilir."],
              ["Hesap başına tek slot", "Kaç kişi izlerse izlesin aynı OKX hesabı 45 sn'de en fazla bir kez işlem görür; çift satış yok. Sadece demo modda emir."],
              ["İki model hemfikir olmalı", "Trade ajanında risk kapısı: ensemble yetkideki min. güveni geçmeli, bir model %35 altındaysa veto. Aksi halde HOLD."],
              ["Bekle bir seçenek", "Model \"işlem yok\" diyebiliyor. En olası sonuç beklemekse ajan USDT'de kalır."],
              ["Her alım OCO ile", "Alımdan hemen sonra ATK ile TP ve SL içeren OCO. Bütçe tavanı, spot, kaldıraç yok."],
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
          <motion.div {...reveal} className={kicker}>07 · İş modeli</motion.div>
          <motion.h2 {...reveal} className={h2}>
            Tahmin tutarsa
            <br />
            <span className="bg-sun px-2">kazanırız.</span>
          </motion.h2>
          <div className="mt-6 grid gap-3 sm:grid-cols-3">
            {[
              ["Kendi ajanın: sadece kârdan", "Kendi ajanını ücretsiz kullanırsın. Zarar eden ajandan ücret yok; sadece high-water mark üstündeki yeni kârdan başarı ücreti alınır. Model maliyetini iki durumda da platform taşır."],
              ["Pazar: x402 ile senaryo", "Ajanını pazara açarsan fiyatı sen koyarsın. Başka kullanıcılar ve ajanlar senaryo başına x402 öder; ajan onlar için canlı bir karar turu çalıştırır. USDC ajanının cüzdanına gelir, platform pay alır."],
              ["Şirketler: sorgu başına x402", "Şirket hesabını bağlayan kurum kendi karar endpoint'ini fiyatlar; başka ajanlar sorgu başına Fuji USDC öder. Oylama geçmişi ve ERC-8004 itibarı kalibre modeli seçtirir: karar kalitesi gelire dönüşür."],
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
          <motion.div {...reveal} className={kicker}>08 · Neden Avalanche, neden OKX</motion.div>
          <motion.h2 {...reveal} className={h2}>Zincirde güven, borsada işlem.</motion.h2>
          <div className="mt-8 grid gap-3 md:grid-cols-2">
            <motion.div {...reveal} className="rounded-card border-2 border-ink bg-paper p-5 shadow-brut">
              <div className="font-display text-3xl uppercase">Avalanche Fuji</div>
              <ul className="mt-3 space-y-2 text-sm text-ink/80">
                <li><b>ERC-8004 kimlik:</b> her ajan kendi cüzdanıyla kaydolur; model, şirket ve yetki hash'i metadata'da. Risk masası <a className="font-mono underline" href="https://testnet.snowtrace.io/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/271" target="_blank" rel="noreferrer">#271</a>, trade ajanı <a className="font-mono underline" href="https://testnet.snowtrace.io/nft/0x8004A818BFB912233c491871b3d84c89A494BD9e/260" target="_blank" rel="noreferrer">#260</a>.</li>
                <li><b>Kararlar zincirde:</b> uygulanan her karar, masanın kendi cüzdanıyla #271'in metadata'sına yazılır (hash, aksiyon, OKX emir no). Bugün 5 karar.</li>
                <li><b>x402:</b> ilk gerçek ödeme 0,01 USDC (EIP-3009), Fuji'de settle: <a className="font-mono underline" href="https://testnet.snowtrace.io/tx/0x0526443c950f970ec47c997e4846311d2914a4d3dd135c001c30d54b24f0caae" target="_blank" rel="noreferrer">0x0526…caae</a>. Ödemeden hemen sonra ajan alıcı için canlı tur çalıştırır.</li>
                <li><b>İtibar:</b> kapanan her işlem PnL ile Reputation Registry'ye yazılır.</li>
              </ul>
            </motion.div>
            <motion.div {...reveal} className="rounded-card border-2 border-ink bg-paper p-5 shadow-brut">
              <div className="font-display text-3xl uppercase">OKX</div>
              <ul className="mt-3 space-y-2 text-sm text-ink/80">
                <li><b>Agent Trade Kit:</b> piyasa, mumlar, bakiye, spot emir ve OCO TP/SL; risk masasının otonom satışları da ATK'nın MCP araçlarıyla.</li>
                <li><b>OKX AI için karar katmanı:</b> OKX AI'da karar modeli entegrasyonu yok. Aviax bunu <span className="font-mono">/api/decision</span> ve MCP aracı <span className="font-mono">aviax_decide</span> ile sağlıyor; her OKX AI ajanı aynı sözleşmeyle karar sorabilir.</li>
                <li><b>Ücretli servis:</b> şirket ve pazar endpoint'leri x402 ile ücretli; başka ajanlar çağırabilir.</li>
              </ul>
            </motion.div>
          </div>
        </div>
      </section>

      {/* 7 · demo */}
      <section data-slide className={`${slide} bg-stage text-white`}>
        <div className={`${wrap} text-center`}>
          <motion.div {...reveal} className="font-mono text-xs font-bold uppercase tracking-[0.2em] text-white/50">09 · Canlı demo</motion.div>
          <motion.h2 {...reveal} className="mt-3 font-display text-6xl uppercase leading-[0.95] sm:text-8xl">
            İzleyin,
            <br />
            <span className="text-sun">karar versin.</span>
          </motion.h2>
          <motion.div {...reveal} className="mt-10 flex flex-wrap justify-center gap-3">
            <Link href="/decision" className="inline-flex min-h-[52px] items-center rounded-btn bg-sun px-6 text-lg font-bold text-black shadow-btn transition-transform hover:-translate-y-px">
              Risk masasını aç →
            </Link>
            <Link href="/agent" className="inline-flex min-h-[52px] items-center rounded-btn border border-white/30 px-6 text-lg font-bold transition-colors hover:bg-white hover:text-black">
              Trade ajanı
            </Link>
            <Link href="/trade" className="inline-flex min-h-[52px] items-center rounded-btn border border-white/30 px-6 text-lg font-bold transition-colors hover:bg-white hover:text-black">
              Trade ekranı
            </Link>
          </motion.div>
          <motion.div {...reveal} className="mx-auto mt-10 inline-flex flex-wrap items-center justify-center gap-6 rounded-card border border-white/15 bg-white/[0.04] p-5 text-left">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/qr-aviax.svg" alt="aviax.pages.dev QR kodu" width={150} height={150} className="rounded-lg bg-white p-2" />
            <div>
              <div className="font-mono text-[10px] uppercase tracking-widest text-white/50">Telefonla deneyin</div>
              <div className="mt-1 font-display text-4xl tracking-wide text-sun">aviax.pages.dev</div>
              <p className="mt-1 max-w-[320px] text-sm text-white/65">&quot;Demoya geç&quot; ile hazır şirket hesabı; risk masası canlı karar verir, stres butonlarıyla çöküşü deneyin.</p>
            </div>
          </motion.div>
          <motion.div {...reveal} className="mx-auto mt-10 max-w-[900px] text-left">
            <LlmVsDecision dark />
          </motion.div>
        </div>
      </section>

      {/* 8 · next */}
      <section data-slide className={`${slide} paper-grid`}>
        <div className={wrap}>
          <motion.div {...reveal} className={kicker}>10 · Sırada ne var</motion.div>
          <motion.h2 {...reveal} className={h2}>
            Doğrulanabilir
            <br />
            <span className="bg-sun px-2">tahmin geçmişi.</span>
          </motion.h2>
          <div className="mt-8 grid gap-3 sm:grid-cols-3">
            {[
              ["Kararlar zincirde", "Her karar zaten keccak256 hash'li. Sırada: uygulanan kararların hash'ini ERC-8004 metadata'sına yazıp denetimi zincire taşımak."],
              ["OKX AI'da yayın", "aviax_decide'ı OKX AI'da A2MCP servisi olarak kaydetmek; portföy, hazine ve yönetişim masalarını açmak."],
              ["Kalibrasyon", "Oylama geçmişinden Brier skoru ve güvenilirlik eğrisi; laya'yı kendi sonuçlarımızla fine-tune etmek."],
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
