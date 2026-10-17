/** Model choices for fleet agents. Client-safe. */
export const MODEL_OPTIONS: { value: string; label: string; group: string; note: string }[] = [
  { value: "openrouter:liquid/lfm-2.5-2.6b:free", label: "LFM 2.5 2.6B", group: "OpenRouter · ücretsiz", note: "testte en istikrarlı ücretsiz model" },
  { value: "openrouter:openrouter/free", label: "OpenRouter Free Router", group: "OpenRouter · ücretsiz", note: "her istekte farklı ücretsiz model" },
  { value: "openrouter:google/gemma-4-31b-it:free", label: "Gemma 4 31B", group: "OpenRouter · ücretsiz", note: "yoğunlukta 429 verebilir" },
  { value: "openrouter:typesafe/jev-router", label: "TypeSafe Jev Router", group: "OpenRouter · ücretli", note: "~2 sn, düşük maliyet" },
  { value: "ollama:strands-decider", label: "Strands Decider 2B", group: "Yerel · Ollama", note: "33 ms, gerçek karar modeli" },
  { value: "ollama:kev", label: "Kev 9B", group: "Yerel · Ollama", note: "JEV benzeri, 11 GB RAM" },
  { value: "ollama:nimble-v3", label: "Nimble v3 9B", group: "Yerel · Ollama", note: "JevBench 201/231" },
  { value: "shadow", label: "Shadow (simülasyon)", group: "Test", note: "model çağrısı yok" },
];

export const modelLabel = (v: string) => MODEL_OPTIONS.find((m) => m.value === v)?.label ?? v.replace(/^(openrouter|ollama):/, "");
