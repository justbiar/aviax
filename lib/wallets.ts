import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

/**
 * Agentic wallet: a Fuji testnet wallet the app creates and controls for the user.
 * Once funded from a faucet it funds agents, settles x402 as facilitator and signs
 * ERC-8004 reputation feedback. Single-user demo store, kept out of git (data/).
 */

type Store = { agentic: { address: Hex; pk: Hex; createdAt: number } | null };
const FILE = path.join(process.cwd(), "data", "wallets.json");

function read(): Store {
  try {
    return JSON.parse(fs.readFileSync(FILE, "utf8")) as Store;
  } catch {
    return { agentic: null };
  }
}

function write(s: Store) {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  fs.writeFileSync(FILE, JSON.stringify(s, null, 2));
}

export const agenticWallet = () => read().agentic;

export function createAgenticWallet() {
  const s = read();
  if (s.agentic) return s.agentic;
  const pk = generatePrivateKey();
  s.agentic = { address: privateKeyToAccount(pk).address, pk, createdAt: Date.now() };
  write(s);
  return s.agentic;
}

export function removeAgenticWallet() {
  write({ agentic: null });
}
