"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { WalletMenu } from "./wallet/WalletMenu";

const LINKS = [
  { href: "/trade", label: "Trade" },
  { href: "/agent", label: "Agent" },
  { href: "/decision", label: "OKX analiz" },
  { href: "/pitch", label: "Sunum" },
];

type Company = { connected: boolean; companyName?: string; demo?: boolean; owner?: boolean };

export function Nav() {
  const path = usePathname();
  const [company, setCompany] = useState<Company | null>(null);
  // Re-check on navigation: connecting or starting the demo happens on other pages.
  useEffect(() => {
    fetch("/api/company/connect", { cache: "no-store" }).then((r) => r.json()).then(setCompany).catch(() => setCompany(null));
  }, [path]);
  return (
    <header className="sticky top-0 z-40 border-b border-ink/10 bg-paper/85 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2" aria-label="Aviax">
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
        {company?.connected ? (
          <Link href="/decision" title={company.companyName} className="hidden min-h-[40px] max-w-[240px] items-center gap-2 rounded-btn border border-ink/15 bg-paper px-3 text-xs font-bold shadow-btn sm:flex">
            <span className="h-2 w-2 shrink-0 rounded-full bg-long" />
            <span className="truncate">{company.companyName ?? "Şirket bağlı"}</span>
            {company.demo && <span className="shrink-0 rounded bg-sun px-1 font-mono text-[9px]">DEMO</span>}
          </Link>
        ) : (
          <Link href="/company" className="hidden min-h-[40px] items-center rounded-btn border-2 border-ink bg-sun px-3 text-xs font-bold sm:flex">Şirketini bağla</Link>
        )}
        <WalletMenu />
      </div>
    </header>
  );
}
