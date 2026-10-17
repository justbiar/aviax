import { NextResponse } from "next/server";
import { OLLAMA_URL } from "@/lib/decide";

export const dynamic = "force-dynamic";

type ModelOption = { value: string; label: string; group: string; note: string };
type Cache = { at: number; data: { options: ModelOption[]; ollama: boolean } };
const g = globalThis as typeof globalThis & { __models?: Cache };

/** Free OpenRouter models (live list) plus decision models installed in the local Ollama. */
export async function GET() {
  // Serve from cache only when it includes local models; an Ollama outage must not stick.
  if (g.__models && g.__models.data.ollama && g.__models.data.options.some((o) => o.value.startsWith("ollama:")) && Date.now() - g.__models.at < 2 * 60_000)
    return NextResponse.json(g.__models.data);
  const options: ModelOption[] = [];

  // Local: only models that are pulled and advertise the "decision" capability.
  let ollama = false;
  try {
    const base = OLLAMA_URL().replace(/\/v1\/systemone$/, "");
    const r = await fetch(`${base}/api/tags`, { cache: "no-store", signal: AbortSignal.timeout(2000) });
    const j = (await r.json()) as { models: { name: string; size: number; capabilities?: string[] }[] };
    ollama = true;
    for (const m of j.models) {
      if (m.capabilities && !m.capabilities.includes("decision")) continue;
      const name = m.name.replace(/:latest$/, "");
      options.push({ value: `ollama:${name}`, label: name, group: "Yerel · Ollama", note: `kurulu · ${(m.size / 1e9).toFixed(1)} GB · tek forward pass` });
    }
  } catch {
    /* Ollama not running */
  }

  // OpenRouter: free text models only (no paid routers).
  try {
    const r = await fetch("https://openrouter.ai/api/v1/models", { cache: "no-store", signal: AbortSignal.timeout(5000) });
    const j = (await r.json()) as {
      data: { id: string; name: string; context_length: number; pricing: { prompt: string; completion: string }; architecture?: { output_modalities?: string[] } }[];
    };
    const free = j.data
      .filter((m) => m.pricing?.prompt === "0" && m.pricing?.completion === "0")
      .filter((m) => (m.architecture?.output_modalities ?? ["text"]).includes("text"))
      // Exclude non-chat and harness-only models (inkling returns 403 outside agent harnesses).
      .filter((m) => !/lyria|content-safety|guard|inkling/i.test(m.id));
    // Put the ones that worked in our tests first.
    const rank = (id: string) => (id === "liquid/lfm-2.5-2.6b:free" ? 0 : id === "openrouter/free" ? 1 : 2);
    free.sort((a, b) => rank(a.id) - rank(b.id) || a.name.localeCompare(b.name));
    for (const m of free) {
      options.push({
        value: `openrouter:${m.id}`,
        label: m.name.replace(/\s*\(free\)\s*$/i, ""),
        group: "OpenRouter · ücretsiz",
        note: m.id === "liquid/lfm-2.5-2.6b:free" ? "testte en istikrarlı ücretsiz model" : m.id === "openrouter/free" ? "her istekte farklı ücretsiz modele yönlendirir" : `${Math.round(m.context_length / 1000)}K bağlam · LLM, yoğunlukta 429 verebilir`,
      });
    }
  } catch {
    /* offline */
  }

  options.push({ value: "shadow", label: "Shadow (simülasyon)", group: "Test", note: "model çağrısı yok" });
  const data = { options, ollama };
  g.__models = { at: Date.now(), data };
  return NextResponse.json(data);
}
