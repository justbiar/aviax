"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";

/**
 * First-visit choice for jury and visitors: try the shared demo (host's OKX demo account and
 * OpenRouter key, held server-side only) or connect their own company. Not shown on localhost
 * owner mode, on the pitch, or once a choice was made in this browser session.
 */

const KEY = "aviax.gate";
const EASE = [0.22, 1, 0.36, 1] as const;

export async function startDemo() {
  const r = await fetch("/api/company/connect", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "demo" }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || "Demo başlatılamadı");
  return j;
}

export function DemoGate() {
  const path = usePathname();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (path?.startsWith("/pitch") || path?.startsWith("/company")) return;
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {
      /* storage blocked */
    }
    if (seen) return;
    fetch("/api/company/connect", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => { if (!j.connected) setOpen(true); })
      .catch(() => setOpen(true));
  }, [path]);

  const close = () => {
    try {
      sessionStorage.setItem(KEY, "1");
    } catch {
      /* storage blocked */
    }
    setOpen(false);
  };

  const demo = async () => {
    setBusy(true);
    setErr("");
    try {
      await startDemo();
      close();
      if (path === "/decision") window.location.reload();
      else router.push("/decision");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 grid place-items-center bg-ink/55 p-4 backdrop-blur-sm" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} role="dialog" aria-modal="true" aria-labelledby="gate-title">
          <motion.div initial={{ opacity: 0, y: 18, scale: 0.98 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: 10 }} transition={{ duration: 0.35, ease: EASE }} className="relative w-full max-w-[760px] rounded-card border-2 border-ink bg-paper p-5 shadow-brut sm:p-7">
            <button onClick={close} className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-btn text-ink/50 hover:bg-ink/5 hover:text-ink" aria-label="Kapat">✕</button>
            <span className="inline-flex items-center gap-2 rounded-full border border-ink/15 bg-paper px-3 py-1 text-xs font-bold">
              <span className="h-2 w-2 rounded-full bg-sun" /> Aviax · nasıl denemek istersin?
            </span>
            <h2 id="gate-title" className="mt-3 font-display text-4xl uppercase leading-[0.95] sm:text-5xl">Demoya geç ya da kendi şirketini bağla</h2>
            <div className="mt-5 grid gap-3 sm:grid-cols-2">
              <button onClick={demo} disabled={busy} className="group flex flex-col rounded-card border-2 border-ink bg-sun p-5 text-left shadow-btn transition-transform duration-150 hover:-translate-y-px disabled:opacity-60">
                <span className="font-mono text-[10px] uppercase tracking-widest">Önerilen · tek tık</span>
                <span className="mt-1 font-display text-2xl uppercase">{busy ? "Demo hazırlanıyor…" : "Demoya geç →"}</span>
                <span className="mt-2 text-sm text-ink/75">Hazır OKX demo şirket hesabı ve model anahtarı ile canlı risk masası. Anahtarlar sunucuda kalır, emir gönderilmez.</span>
              </button>
              <a href="/company" onClick={close} className="flex flex-col rounded-card border-2 border-ink bg-paper p-5 text-left shadow-btn transition-transform duration-150 hover:-translate-y-px">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted">Kendi verinle</span>
                <span className="mt-1 font-display text-2xl uppercase">Kendi şirketini bağla →</span>
                <span className="mt-2 text-sm text-ink/70">Kendi OKX demo API anahtarın (salt okunur), Fuji cüzdanın ve istersen kendi OpenRouter modelin.</span>
              </a>
            </div>
            {err && <p className="mt-3 rounded-btn border border-short/30 bg-short/5 p-3 text-sm text-short">{err}</p>}
            <button onClick={close} className="mt-4 text-sm font-semibold text-muted underline-offset-4 hover:text-ink hover:underline">Şimdilik sadece gez</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
