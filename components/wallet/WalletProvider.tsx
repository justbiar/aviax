"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { encodeFunctionData, parseAbi, parseEther, toHex } from "viem";

/**
 * Wallet session for the app: either the user's browser wallet (Core / MetaMask via
 * EIP-1193, Avalanche Fuji) or an agentic wallet the app creates and controls.
 */

type Mode = "browser" | "agentic";
export type X402Requirements = { scheme: string; network: string; maxAmountRequired: string; payTo: `0x${string}`; asset: `0x${string}`; maxTimeoutSeconds: number; extra: { name: string; version: string } };
type Eip1193 = { request: (a: { method: string; params?: unknown[] }) => Promise<unknown>; on?: (e: string, f: (x: unknown) => void) => void };
declare global {
  interface Window {
    ethereum?: Eip1193;
    avalanche?: Eip1193;
  }
}

export type WalletState = {
  mode: Mode | null;
  address: `0x${string}` | null;
  avax: number | null;
  usdc: number | null;
  busy: boolean;
  error: string | null;
  hasInjected: boolean;
  connectBrowser: () => Promise<void>;
  createAgentic: () => Promise<void>;
  useAgentic: () => Promise<void>;
  disconnect: () => void;
  refresh: () => Promise<void>;
  /** Browser mode: send AVAX (gas) and optionally USDC from the user's wallet to an address. */
  fund: (to: `0x${string}`, avax: number, usdc: number) => Promise<string[]>;
  /** Browser mode: sign an x402 exact-scheme (EIP-3009) payment and return the X-PAYMENT header. */
  signX402: (req: X402Requirements) => Promise<string>;
};

const FUJI_ID = "0xa869"; // 43113
const USDC = "0x5425890298aed601595a70AB815c96711a31Bc65";
const KEY = "aviax.wallet";
const Ctx = createContext<WalletState | null>(null);

const provider = () => (typeof window === "undefined" ? undefined : window.avalanche ?? window.ethereum);
const store = {
  get: (): { mode: Mode; address: string } | null => {
    try {
      return JSON.parse(localStorage.getItem(KEY) || "null");
    } catch {
      return null;
    }
  },
  set: (v: { mode: Mode; address: string } | null) => {
    try {
      if (v) localStorage.setItem(KEY, JSON.stringify(v));
      else localStorage.removeItem(KEY);
    } catch {
      /* storage blocked */
    }
  },
};

async function ensureFuji(p: Eip1193) {
  try {
    await p.request({ method: "wallet_switchEthereumChain", params: [{ chainId: FUJI_ID }] });
  } catch (e) {
    if ((e as { code?: number }).code !== 4902) throw e;
    await p.request({
      method: "wallet_addEthereumChain",
      params: [{ chainId: FUJI_ID, chainName: "Avalanche Fuji C-Chain", nativeCurrency: { name: "Avalanche", symbol: "AVAX", decimals: 18 }, rpcUrls: ["https://api.avax-test.network/ext/bc/C/rpc"], blockExplorerUrls: ["https://testnet.snowtrace.io"] }],
    });
  }
}

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [mode, setMode] = useState<Mode | null>(null);
  const [address, setAddress] = useState<`0x${string}` | null>(null);
  const [avax, setAvax] = useState<number | null>(null);
  const [usdc, setUsdc] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInjected, setHasInjected] = useState(false);

  const refresh = useCallback(async () => {
    if (!address) return;
    try {
      const r = await fetch(`/api/wallet/balance?address=${address}`, { cache: "no-store" });
      const j = await r.json();
      setAvax(j.avax ?? null);
      setUsdc(j.usdc ?? null);
    } catch {
      /* keep last */
    }
  }, [address]);

  // Restore the last session.
  useEffect(() => {
    setHasInjected(Boolean(provider()));
    const s = store.get();
    if (s?.mode === "agentic") {
      fetch("/api/wallet").then((r) => r.json()).then((j) => {
        if (j.agentic) {
          setMode("agentic");
          setAddress(j.agentic.address);
        } else store.set(null);
      });
    } else if (s?.mode === "browser") {
      setMode("browser");
      setAddress(s.address as `0x${string}`);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 10_000);
    return () => clearInterval(id);
  }, [refresh]);

  const connectBrowser = useCallback(async () => {
    const p = provider();
    if (!p) {
      setError("Tarayıcı cüzdanı bulunamadı. Core veya MetaMask eklentisini kur.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const accounts = (await p.request({ method: "eth_requestAccounts" })) as string[];
      await ensureFuji(p);
      const a = accounts[0] as `0x${string}`;
      setMode("browser");
      setAddress(a);
      store.set({ mode: "browser", address: a });
    } catch (e) {
      setError((e as Error).message?.slice(0, 140) || "Bağlantı reddedildi");
    } finally {
      setBusy(false);
    }
  }, []);

  const useAgentic = useCallback(async () => {
    const j = await fetch("/api/wallet").then((r) => r.json());
    if (!j.agentic) return;
    setMode("agentic");
    setAddress(j.agentic.address);
    store.set({ mode: "agentic", address: j.agentic.address });
  }, []);

  const createAgentic = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const j = await fetch("/api/wallet", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "create" }) }).then((r) => r.json());
      setMode("agentic");
      setAddress(j.agentic.address);
      store.set({ mode: "agentic", address: j.agentic.address });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, []);

  const disconnect = useCallback(() => {
    setMode(null);
    setAddress(null);
    setAvax(null);
    setUsdc(null);
    store.set(null);
  }, []);

  const fund = useCallback(
    async (to: `0x${string}`, avaxAmt: number, usdcAmt: number) => {
      const p = provider();
      if (!p || !address) throw new Error("Cüzdan bağlı değil");
      await ensureFuji(p);
      const hashes: string[] = [];
      hashes.push((await p.request({ method: "eth_sendTransaction", params: [{ from: address, to, value: toHex(parseEther(String(avaxAmt))) }] })) as string);
      if (usdcAmt > 0) {
        const data = encodeFunctionData({ abi: parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]), functionName: "transfer", args: [to, BigInt(Math.round(usdcAmt * 1e6))] });
        hashes.push((await p.request({ method: "eth_sendTransaction", params: [{ from: address, to: USDC, data }] })) as string);
      }
      setTimeout(refresh, 4000);
      return hashes;
    },
    [address, refresh],
  );

  const signX402 = useCallback(
    async (r: X402Requirements) => {
      const p = provider();
      if (!p || !address) throw new Error("Cüzdan bağlı değil");
      await ensureFuji(p);
      const now = Math.floor(Date.now() / 1000);
      const authorization = {
        from: address,
        to: r.payTo,
        value: r.maxAmountRequired,
        validAfter: String(now - 60),
        validBefore: String(now + r.maxTimeoutSeconds),
        nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
      };
      const typed = {
        types: {
          EIP712Domain: [
            { name: "name", type: "string" },
            { name: "version", type: "string" },
            { name: "chainId", type: "uint256" },
            { name: "verifyingContract", type: "address" },
          ],
          TransferWithAuthorization: [
            { name: "from", type: "address" },
            { name: "to", type: "address" },
            { name: "value", type: "uint256" },
            { name: "validAfter", type: "uint256" },
            { name: "validBefore", type: "uint256" },
            { name: "nonce", type: "bytes32" },
          ],
        },
        primaryType: "TransferWithAuthorization",
        domain: { name: r.extra.name, version: r.extra.version, chainId: 43113, verifyingContract: r.asset },
        message: authorization,
      };
      const signature = (await p.request({ method: "eth_signTypedData_v4", params: [address, JSON.stringify(typed)] })) as string;
      const payload = { x402Version: 1, scheme: "exact", network: r.network, payload: { signature, authorization } };
      return btoa(JSON.stringify(payload));
    },
    [address],
  );

  return (
    <Ctx.Provider value={{ mode, address, avax, usdc, busy, error, hasInjected, connectBrowser, createAgentic, useAgentic, disconnect, refresh, fund, signX402 }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWallet() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useWallet outside WalletProvider");
  return c;
}
