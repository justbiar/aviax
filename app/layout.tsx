import type { Metadata } from "next";
import { Anton, Figtree, JetBrains_Mono } from "next/font/google";
import { Nav } from "@/components/Nav";
import { DemoGate } from "@/components/DemoGate";
import { WalletProvider } from "@/components/wallet/WalletProvider";
import "./globals.css";

const display = Anton({ subsets: ["latin", "latin-ext"], weight: "400", variable: "--font-display" });
const sans = Figtree({ subsets: ["latin", "latin-ext"], variable: "--font-sans" });
const mono = JetBrains_Mono({ subsets: ["latin", "latin-ext"], variable: "--font-mono" });

export const metadata: Metadata = {
  title: "Aviax · Prediction-native trading agent",
  description: "An autonomous OKX trading agent whose decisions come from decision models as probability distributions, not generated text.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="tr" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body className="min-h-screen font-sans">
        <WalletProvider>
          <Nav />
          {children}
          <DemoGate />
        </WalletProvider>
      </body>
    </html>
  );
}
