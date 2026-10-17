/** Model choices are served live by /api/models (free OpenRouter + installed Ollama models). */
export type ModelOption = { value: string; label: string; group: string; note: string };

export const modelLabel = (v: string) => (v === "shadow" ? "Shadow (simülasyon)" : v.replace(/^(openrouter|ollama):/, "").replace(/:free$/, ""));
