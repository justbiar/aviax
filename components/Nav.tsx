"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { WalletMenu } from "./wallet/WalletMenu";

type Status = { okx: boolean; demo: boolean; jev: boolean; jevProvider?: string; laya: boolean; llm: boolean };

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/agent", label: "Agent" },
  { href: "/pitch", label: "Sunum" },
];

export function Nav() {
  const path = usePathname();
  const [s, setS] = useState<Status | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/status").then((r) => r.json()).then(setS).catch(() => null);
  }, []);
  useEffect(() => {
    const close = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const rows = s
    ? [
        { k: "OKX", v: s.okx ? (s.demo ? "Demo hesap bağlı" : "Canlı hesap") : "Anahtar yok", ok: s.okx },
        { k: "Agent Trade Kit", v: "MCP sunucusu", ok: true },
        { k: "JEV", v: s.jev ? (s.jevProvider === "openrouter" ? "OpenRouter" : s.jevProvider === "endpoint" ? "Yerel · Ollama" : "TypeSafe") : "Simülasyon", ok: s.jev },
        { k: "LAYA", v: s.laya ? "Yerel · Ollama" : "Simülasyon", ok: s.laya },
        { k: "Anlatıcı LLM", v: s.llm ? "OpenRouter" : "Kapalı", ok: s.llm },
      ]
    : [];
  const healthy = s?.okx;

  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Link href="/agent" className="flex items-center gap-2" aria-label="Aviax">
          <span className="rounded-[8px] border-2 border-ink bg-sun px-2 py-0.5 font-display text-xl leading-tight tracking-wide shadow-brut">AVIAX</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Ana menü">
          {LINKS.map((l) => {
            const active = path?.startsWith(l.href);
            return (
              <Link key={l.href} href={l.href} className={`min-h-[40px] rounded-btn px-3 py-2 text-sm font-bold transition-colors duration-150 ${active ? "bg-ink text-paper" : "text-ink/70 hover:bg-ink/5 hover:text-ink"}`}>
                {l.label}
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto" />
        <WalletMenu />
      </div>
    </header>
  );
}
