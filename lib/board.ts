import fs from "node:fs";
import path from "node:path";

/**
 * Agentic HR: a company's board (kadro) of hired agents. Listed agents are hired with an x402
 * payment that settles on Fuji to the agent's own wallet; the platform takes a commission on
 * every hire and paid service. Kept per company key in data/board.json.
 */

export const COMMISSION_PCT = Number(process.env.PLATFORM_COMMISSION_PCT || 10);
/** Shared jury demo: cap paid hires so visitors cannot drain the host wallet. */
export const DEMO_HIRE_CAP = 20;

export type Hire = {
  agentId: string;
  name: string;
  erc8004: string | null;
  role: string;
  priceUsdc: number;
  commissionUsdc: number;
  agentNetUsdc: number;
  tx: string;
  payer: string;
  hiredAt: number;
};

const FILE = path.join(process.cwd(), "data", "board.json");
const g = globalThis as typeof globalThis & { __aviaxBoard?: Record<string, Hire[]> };

function store() {
  if (!g.__aviaxBoard) {
    try {
      g.__aviaxBoard = JSON.parse(fs.readFileSync(FILE, "utf8"));
    } catch {
      g.__aviaxBoard = {};
    }
  }
  return g.__aviaxBoard!;
}

function save() {
  try {
    fs.mkdirSync(path.dirname(FILE), { recursive: true });
    fs.writeFileSync(FILE, JSON.stringify(store()));
  } catch {
    /* best-effort */
  }
}

export const board = (key: string) => store()[key] ?? [];
/** Every paid hire ever (releases do not reset it), so the demo cap cannot be looped around. */
export const totalHires = (key: string) => (store()[`${key}#log`] ?? []).length;
export const hireLog = (key: string) => store()[`${key}#log`] ?? [];

export function recordHire(key: string, h: Omit<Hire, "commissionUsdc" | "agentNetUsdc">) {
  const commissionUsdc = Number(((h.priceUsdc * COMMISSION_PCT) / 100).toFixed(6));
  const entry: Hire = { ...h, commissionUsdc, agentNetUsdc: Number((h.priceUsdc - commissionUsdc).toFixed(6)) };
  const list = (store()[key] ??= []);
  if (!list.some((x) => x.agentId === h.agentId)) list.push(entry);
  (store()[`${key}#log`] ??= []).push(entry);
  save();
  return entry;
}

export function releaseHire(key: string, agentId: string) {
  const list = store()[key] ?? [];
  store()[key] = list.filter((x) => x.agentId !== agentId);
  save();
}
