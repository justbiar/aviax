import fs from "node:fs";
import path from "node:path";
import { runAgent, type AgentEvent, type Plan } from "./agent";
import { cancelAlgo, getAlgoOrder, getOrder, getTicker, hasOkxKeys, placeOrder } from "./okx";

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
  side: "long";
  /** base-currency quantity held by this agent */
  qty: string;
  algoId?: string;
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
    a.position.reason = "manual";
    await trackPosition(a).catch(() => null);
  }
  if (action === "delete") {
    if (a.position) await exitPosition(a.position).catch(() => null);
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

  for (const a of agents) {
    if (store.busy.has(a.id)) continue;
    if (a.position) {
      await trackPosition(a).catch(() => null);
      continue;
    }
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

const FEE = 0.001; // OKX spot taker fee per side, used when the exact fill is not available

/** Market-sells the agent's spot quantity after cancelling its OCO. Returns the fill price. */
async function exitPosition(t: Trade) {
  if (t.algoId) await cancelAlgo(t.instId, t.algoId).catch(() => null);
  const r = await placeOrder({ instId: t.instId, side: "sell", ordType: "market", sz: t.qty, tdMode: "cash" });
  const fill = await getOrder(t.instId, r[0].ordId).catch(() => null);
  return Number(fill?.avgPx) || Number((await getTicker(t.instId)).last);
}

async function trackPosition(a: FleetAgent) {
  const t = a.position!;
  const last = Number((await getTicker(t.instId)).last);
  const qty = Number(t.qty);
  a.upl = (last - t.entry) * qty - (t.entry + last) * qty * FEE;
  a.phase = "in_position";

  let exit: number | null = null;
  let reason: Trade["reason"] = t.reason;
  if (t.reason === "manual" || Date.now() - t.openedAt > a.maxHoldMin * 60_000) {
    // Manual close request or time stop.
    reason = t.reason ?? "timeout";
    exit = await exitPosition(t);
  } else if (t.algoId) {
    const algo = await getAlgoOrder(t.algoId).catch(() => null);
    if (algo && (algo.state === "effective" || algo.state === "partially_effective")) {
      exit = Number(algo.actualPx) || last;
      reason = algo.actualSide === "tp" ? "tp" : algo.actualSide === "sl" ? "sl" : Math.abs(exit - t.tp) < Math.abs(exit - t.sl) ? "tp" : "sl";
    } else if (algo && (algo.state === "canceled" || algo.state === "order_failed")) {
      // OCO removed outside the agent: flatten so the ledger stays honest.
      reason = "external";
      exit = await exitPosition(t);
    }
  }
  if (exit === null) return;

  const pnl = (exit - t.entry) * qty - (t.entry + exit) * qty * FEE;
  t.exit = exit;
  t.pnl = pnl;
  t.reason = reason;
  t.closedAt = Date.now();
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
  let fill: { algoId?: string; qty?: string; avgPx?: number } = {};
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
        fill = { algoId: ev.algoId, qty: ev.qty, avgPx: ev.avgPx };
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
    const qty = fill.qty ?? plan.contracts;
    const entry = fill.avgPx ?? plan.entry;
    a.position = {
      instId: plan.instId,
      side: "long",
      qty,
      algoId: fill.algoId,
      entry,
      contracts: qty,
      notional: Number(qty) * entry,
      leverage: 1,
      margin: Number(qty) * entry,
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
