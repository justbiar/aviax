import fs from "node:fs";
import path from "node:path";
import { runAgent, type AgentEvent, type Plan } from "./agent";
import { closePosition, getPositions, getPositionsHistory, hasOkxKeys, type Position } from "./okx";

/**
 * Agent fleet: each agent gets a USDT budget and a model, then trades on its own
 * in a loop (scan, decide, open with TP/SL, wait for exit, repeat).
 * All agents share one OKX demo account, so an instrument can be held by only one
 * agent at a time and every agent keeps its own virtual ledger.
 */

export type AgentStatus = "running" | "paused";
export type AgentPhase = "idle" | "thinking" | "in_position" | "cooldown" | "error";

export type Trade = {
  instId: string;
  side: "long" | "short";
  entry: number;
  exit?: number;
  contracts: string;
  notional: number;
  leverage: number;
  margin: number;
  tp: number;
  sl: number;
  ordId?: string;
  openedAt: number;
  closedAt?: number;
  pnl?: number;
  reason?: "tp" | "sl" | "manual" | "timeout" | "external";
};

export type FleetAgent = {
  id: string;
  name: string;
  model: string;
  budget: number;
  intervalSec: number;
  maxLeverage: number;
  universe: number;
  maxHoldMin: number;
  status: AgentStatus;
  createdAt: number;
  phase: AgentPhase;
  position: Trade | null;
  trades: Trade[];
  realizedPnl: number;
  runs: number;
  nextRunAt: number;
  lastError: string | null;
  lastVerdict: string | null;
  upl: number;
  // live run stream (not persisted)
  runId: number;
  events: AgentEvent[];
};

export type NewAgent = Pick<FleetAgent, "name" | "model" | "budget" | "intervalSec" | "maxLeverage" | "universe" | "maxHoldMin">;

type Store = { agents: Map<string, FleetAgent>; busy: Set<string>; timer?: NodeJS.Timeout; loaded: boolean };
const g = globalThis as typeof globalThis & { __fleet?: Store };
const store: Store = (g.__fleet ??= { agents: new Map(), busy: new Set(), loaded: false });

const FILE = path.join(process.cwd(), "data", "fleet.json");

function load() {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as FleetAgent[];
    for (const a of raw) store.agents.set(a.id, { ...a, events: [], runId: 0, phase: a.position ? "in_position" : "idle", upl: 0 });
  } catch {
    /* first start */
  }
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const out = [...store.agents.values()].map(({ events: _e, runId: _r, ...rest }) => rest);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
}

export function ensureFleet() {
  load();
  if (!store.timer) store.timer = setInterval(() => tick().catch(() => null), 5000);
}

export const equity = (a: FleetAgent) => a.budget + a.realizedPnl + (a.position ? a.upl : 0);
const available = (a: FleetAgent) => Math.max(0, a.budget + a.realizedPnl);

export function listAgents() {
  ensureFleet();
  return [...store.agents.values()].map((a) => {
    const { events, ...rest } = a;
    return { ...rest, equity: equity(a), busy: store.busy.has(a.id), eventCount: events.length };
  });
}

export function getEvents(id: string, since: number) {
  const a = store.agents.get(id);
  if (!a) return null;
  return { runId: a.runId, events: a.events.slice(since), total: a.events.length };
}

export function createAgent(input: NewAgent) {
  ensureFleet();
  const id = Math.random().toString(36).slice(2, 8);
  const a: FleetAgent = {
    ...input,
    id,
    status: "running",
    createdAt: Date.now(),
    phase: "idle",
    position: null,
    trades: [],
    realizedPnl: 0,
    runs: 0,
    nextRunAt: Date.now(),
    lastError: null,
    lastVerdict: null,
    upl: 0,
    runId: 0,
    events: [],
  };
  store.agents.set(id, a);
  save();
  tick().catch(() => null);
  return a;
}

export async function agentAction(id: string, action: "start" | "pause" | "close" | "delete" | "run") {
  const a = store.agents.get(id);
  if (!a) throw new Error("agent not found");
  if (action === "start") {
    a.status = "running";
    a.nextRunAt = Date.now();
  }
  if (action === "pause") a.status = "paused";
  if (action === "run") a.nextRunAt = 0;
  if (action === "close" && a.position) {
    await closePosition(a.position.instId).catch(() => null);
    a.position.reason = "manual";
  }
  if (action === "delete") {
    if (a.position) await closePosition(a.position.instId).catch(() => null);
    store.agents.delete(id);
  }
  save();
  if (action === "start" || action === "run") tick().catch(() => null);
}

/* ---------------- scheduler ---------------- */

async function tick() {
  load();
  const agents = [...store.agents.values()];
  if (agents.length === 0 || !hasOkxKeys()) return;

  // One positions snapshot per tick for every agent holding something.
  let positions: Position[] | null = null;
  if (agents.some((a) => a.position)) positions = await getPositions().catch(() => null);

  for (const a of agents) {
    if (store.busy.has(a.id)) continue;
    if (a.position && positions) {
      await trackPosition(a, positions);
      continue;
    }
    if (a.position) continue;
    if (a.status !== "running") continue;
    if (Date.now() < a.nextRunAt) {
      if (a.phase !== "error") a.phase = a.trades.length ? "cooldown" : "idle";
      continue;
    }
    if (available(a) < 5) {
      a.lastError = "Bütçe tükendi";
      a.status = "paused";
      save();
      continue;
    }
    void cycle(a);
  }
}

async function trackPosition(a: FleetAgent, positions: Position[]) {
  const t = a.position!;
  const live = positions.find((p) => p.instId === t.instId && Number(p.pos) !== 0);
  if (live) {
    a.upl = Number(live.upl);
    a.phase = "in_position";
    // Time stop: never hold longer than maxHoldMin.
    if (Date.now() - t.openedAt > a.maxHoldMin * 60_000) {
      await closePosition(t.instId).catch(() => null);
      t.reason = "timeout";
    }
    return;
  }
  // Position is gone: TP, SL, manual or time stop filled. Pull realised PnL.
  const hist = await getPositionsHistory(t.instId).catch(() => []);
  const h = hist.find((x) => Number(x.uTime) >= t.openedAt - 5_000);
  const exit = h ? Number(h.closeAvgPx) : t.side === "long" ? (a.upl >= 0 ? t.tp : t.sl) : a.upl >= 0 ? t.tp : t.sl;
  const pnl = h ? Number(h.realizedPnl) : a.upl;
  t.exit = exit;
  t.pnl = pnl;
  t.closedAt = Date.now();
  t.reason ??= Math.abs(exit - t.tp) < Math.abs(exit - t.sl) ? "tp" : "sl";
  a.realizedPnl += pnl;
  a.trades = [t, ...a.trades].slice(0, 50);
  a.position = null;
  a.upl = 0;
  a.phase = "cooldown";
  a.nextRunAt = Date.now() + a.intervalSec * 1000;
  save();
}

async function cycle(a: FleetAgent) {
  store.busy.add(a.id);
  a.phase = "thinking";
  a.runs += 1;
  a.runId += 1;
  a.events = [];
  a.lastError = null;
  const held = [...store.agents.values()].filter((x) => x.id !== a.id && x.position).map((x) => x.position!.instId);
  let plan: Plan | null = null;
  let ordId: string | undefined;
  let ok = false;
  try {
    for await (const ev of runAgent({
      execute: true,
      universe: a.universe,
      model: a.model,
      budget: available(a),
      maxLeverage: a.maxLeverage,
      exclude: held,
      strict: a.model !== "shadow",
      tag: `av${a.id}`,
    })) {
      a.events.push(ev);
      if (ev.type === "plan") plan = ev.plan;
      if (ev.type === "order") {
        ok = ev.ok;
        ordId = ev.ordId;
        if (!ev.ok) a.lastError = ev.detail;
      }
      if (ev.type === "done") a.lastVerdict = ev.verdict;
    }
  } catch (e) {
    const msg = (e as Error).message;
    a.lastError = msg;
    a.lastVerdict = "error";
    a.events.push({ type: "log", tone: "err", text: msg }, { type: "done", ms: 0, verdict: "error" });
  }
  if (ok && plan) {
    a.position = {
      instId: plan.instId,
      side: plan.side,
      entry: plan.entry,
      contracts: plan.contracts,
      notional: plan.notional,
      leverage: plan.leverage,
      margin: plan.notional / plan.leverage,
      tp: plan.tp,
      sl: plan.sl,
      ordId,
      openedAt: Date.now(),
    };
    a.phase = "in_position";
  } else {
    a.phase = a.lastVerdict === "error" ? "error" : "cooldown";
    a.nextRunAt = Date.now() + a.intervalSec * 1000;
  }
  store.busy.delete(a.id);
  save();
}
