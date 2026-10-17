import { NextRequest, NextResponse } from "next/server";
import { decide, type Question } from "@/lib/decide";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const STATE = "BTC-USDT spot. 24h change +0.4%, 4h +0.3%, 1h +0.1%. EMA20 is above EMA50 by 0.12%. RSI(14, 1H) 58. 1H ATR 0.60% of price.";
const QUESTIONS: Record<string, Question> = {
  direction: {
    type: "choice",
    instructions: "Spot only, no shorting. Does buying now have positive expected value over the next 4 hours, or is holding USDT better?",
    criteria: { long: "Buy the asset now", flat: "Stay in USDT, no edge" },
  },
};

/**
 * Connection test for the wizard: sends one real decision to each selected model.
 * A model passes only if it answers live (no shadow fallback) with a valid distribution.
 */
export async function POST(req: NextRequest) {
  const { model, validator, openrouterKey } = (await req.json()) as { model: string; validator?: string; openrouterKey?: string };
  const targets = [{ role: "Ana model", spec: model }, ...(validator && validator !== model && validator !== "shadow" ? [{ role: "İkinci görüş", spec: validator }] : [])];

  const results = await Promise.all(
    targets.map(async ({ role, spec }) => {
      const t0 = Date.now();
      const r = await decide("jev", STATE, QUESTIONS, spec, openrouterKey);
      const a = r.answers.direction;
      const sum = a ? Object.values(a.probabilities).reduce((s, p) => s + p, 0) : 0;
      const ok = r.source === "live" && !r.error && a && Math.abs(sum - 1) < 0.05;
      return {
        role,
        model: spec.replace(/^(ollama|openrouter):/, ""),
        ok: Boolean(ok),
        ms: Date.now() - t0,
        // Never show the shadow fallback's numbers as if the model had answered.
        probabilities: ok ? a.probabilities : null,
        choice: ok ? a.choice ?? null : null,
        error: ok ? null : r.error ? r.error.slice(0, 200) : "Model canlı cevap vermedi",
      };
    }),
  );
  return NextResponse.json({ ok: results.every((r) => r.ok), results });
}
