"use client";

import { motion } from "framer-motion";

/** LLM agent vs decision model, with the numbers we measured during the build. */
const ROWS: [string, string, string][] = [
  ["Neyi iyi yapar", "Talimat izler, plan kurar, araç çağırır, açıklar", "Verilen seçenekler arasında karar verir"],
  ["Karar anındaki çıktı", "Metin (JSON'a parse etmek gerekir)", "Olasılık dağılımı (choice · score · noul)"],
  ["Hız (bizim ölçümümüz)", "Ücretsiz LLM'ler: karar turu başına 4–108 sn", "strands-decider ~20–900 ms · laya ~90–170 ms"],
  ["Tekrarlanabilirlik", "Aynı soruya farklı cevap; yönlendirme her seferinde başka model", "Aynı girdi, aynı dağılım (iki turda birebir aynı)"],
  ["Hata türü", "Boş cevap, bozuk JSON, 429 kota", "Model kapalıysa açık hata; sahte karar üretilmez"],
  ["Risk kuralına bağlanma", "Metinden sayı çıkarmak gerekir", "p ≥ eşik doğrudan uygulanır"],
  ["Nerede çalışır", "Bulut API, anahtar ve kota", "Yerelde Ollama, 0,8–2 GB"],
];

export function ModelCompare() {
  return (
    <div className="overflow-hidden rounded-card border border-ink/15 bg-paper shadow-card">
      <div className="grid grid-cols-[1fr_1.2fr_1.2fr] border-b border-ink/15 bg-ink text-paper">
        <div className="p-3 text-xs font-bold uppercase tracking-wider opacity-70" />
        <div className="p-3 font-display text-xl uppercase">LLM ajanı</div>
        <div className="bg-sun p-3 font-display text-xl uppercase text-ink">Karar modeli</div>
      </div>
      {ROWS.map(([k, llm, dm], i) => (
        <motion.div
          key={k}
          initial={{ opacity: 0, y: 8 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.6 }}
          transition={{ duration: 0.4, delay: i * 0.05 }}
          className="grid grid-cols-[1fr_1.2fr_1.2fr] border-b border-ink/10 text-sm last:border-0"
        >
          <div className="p-3 font-bold">{k}</div>
          <div className="p-3 text-ink/70">{llm}</div>
          <div className="bg-sun/10 p-3 font-medium">{dm}</div>
        </motion.div>
      ))}
    </div>
  );
}
