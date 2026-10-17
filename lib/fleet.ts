import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { runAgent, type AgentEvent, type Plan } from "./agent";
import { balances, fundAvax, fundUsdc, giveFeedback, hasChain, mandateHash, registerAgent, txUrl, usdcBalance } from "./chain";
import { CYCLE_PRICE_USDC, payAndFetch } from "./x402";
import { cancelAlgo, getAlgoOrder, getOrder, getTicker, hasOkxKeys, placeOrder } from "./okx";

/**
 * Agent fleet: each agent gets a USDT budget and a model, then trades on its own
 * in a loop (scan, decide, open with TP/SL, wait for exit, repeat).
 * All agents share one OKX demo account, so an instrument can be held by only one
 * agent at a time and every agent keeps its own virtual ledger.
 */

/** Performance fee on new profit only (high-water mark). */
export const SUCCESS_FEE = Number(process.env.SUCCESS_FEE_PCT || 18) / 100;

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
  fee?: number;
  reason?: "tp" | "sl" | "manual" | "timeout" | "external";
};

export type Mandate = {
  /** base symbols the agent may buy; empty = any liquid pair */
  allowed: string[];
  maxTradeUsdt: number;
  maxDailyTrades: number;
  /** pause the agent when equity falls this % below the budget */
  maxDrawdownPct: number;
  /** minimum ensemble p(EV>0) to execute */
  minGate: number;
};

export type ChainLog = { at: number; kind: "fund" | "register" | "x402" | "reputation" | "error" | "info"; text: string; tx?: string };

export type ChainState = {
  enabled: boolean;
  status: "off" | "awaiting_funds" | "launching" | "registered" | "failed";
  /** who funds the agent: the app's agentic wallet, or the user's browser wallet */
  funding: "agentic" | "browser";
  /** the user's address that owns/funds this agent */
  owner: Hex | null;
  wallet: Hex;
  agentId: string | null;
  mandateHash: Hex | null;
  paidUsdc: number;
  payments: number;
  feedbacks: number;
  log: ChainLog[];
  error: string | null;
};

export type FleetAgent = {
  id: string;
  name: string;
  model: string;
  /** second-opinion model in the LAYA seat */
  validator: string;
  /** bring-your-own OpenRouter key (never sent to the client) */
  openrouterKey?: string;
  mandate: Mandate;
  /** success fee: equity high-water mark and fees charged so far (only on new profit) */
  hwm: number;
  feesPaid: number;
  /** agent wallet private key on Fuji testnet (never sent to the client) */
  walletPk: Hex;
  chain: ChainState;
  /** "paper": live prices, simulated fills. "okx": real orders on the OKX demo account. */
  execution: "paper" | "okx";
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

export type NewAgent = Pick<FleetAgent, "name" | "model" | "validator" | "openrouterKey" | "mandate" | "execution" | "budget" | "intervalSec" | "maxLeverage" | "universe" | "maxHoldMin"> & {
  launchOnFuji: boolean;
  funding: "agentic" | "browser";
  owner: Hex | null;
};

type Store = { agents: Map<string, FleetAgent>; busy: Set<string>; timer?: NodeJS.Timeout; loaded: boolean };
const g = globalThis as typeof globalThis & { __fleet?: Store };
const store: Store = (g.__fleet ??= { agents: new Map(), busy: new Set(), loaded: false });

const FILE = path.join(process.cwd(), "data", "fleet.json");

function load() {
  if (store.loaded) return;
  store.loaded = true;
  try {
    const raw = JSON.parse(fs.readFileSync(FILE, "utf8")) as FleetAgent[];
    for (const a of raw) store.agents.set(a.id, migrate({ ...a, events: [], runId: 0, phase: a.position ? "in_position" : "idle", upl: 0 }));
  } catch {
    /* first start */
  }
}

/** Fills fields added in later versions so older agents (file or memory) keep working. */
function migrate(a: FleetAgent): FleetAgent {
  a.execution ??= "okx";
  a.validator ??= "ollama:laya";
  a.mandate ??= { allowed: [], maxTradeUsdt: a.budget, maxDailyTrades: 20, maxDrawdownPct: 20, minGate: 0.55 };
  a.walletPk ??= generatePrivateKey();
  a.chain ??= { enabled: false, status: "off", funding: "agentic", owner: null, wallet: privateKeyToAccount(a.walletPk).address, agentId: null, mandateHash: null, paidUsdc: 0, payments: 0, feedbacks: 0, log: [], error: null };
  a.chain.funding ??= "agentic";
  a.chain.owner ??= null;
  a.events ??= [];
  a.hwm ??= a.budget;
  a.feesPaid ??= 0;
  return a;
}

function save() {
  fs.mkdirSync(path.dirname(FILE), { recursive: true });
  const out = [...store.agents.values()].map(({ events: _e, runId: _r, ...rest }) => rest);
  fs.writeFileSync(FILE, JSON.stringify(out, null, 2));
}

export function ensureFleet() {
  load();
  for (const a of store.agents.values()) migrate(a);
  if (!store.timer) store.timer = setInterval(() => tick().catch(() => null), 5000);
}

export const equity = (a: FleetAgent) => a.budget + a.realizedPnl + (a.position ? a.upl : 0);
const available = (a: FleetAgent) => Math.max(0, a.budget + a.realizedPnl);

export function listAgents() {
  ensureFleet();
  return [...store.agents.values()].map((a) => {
    const { events, walletPk: _pk, openrouterKey: _k, ...rest } = a;
    return { ...rest, hasOwnKey: Boolean(_k), equity: equity(a), busy: store.busy.has(a.id), eventCount: events.length, tradesToday: tradesToday(a) };
  });
}

export function getEvents(id: string, since: number) {
  const a = store.agents.get(id);
  if (!a) return null;
  return { runId: a.runId, events: a.events.slice(since), total: a.events.length };
}

const tradesToday = (a: FleetAgent) => {
  const day = new Date().toDateString();
  return [...a.trades, ...(a.position ? [a.position] : [])].filter((t) => new Date(t.openedAt).toDateString() === day).length;
};

function chainLog(a: FleetAgent, kind: ChainLog["kind"], text: string, tx?: string) {
  a.chain.log = [{ at: Date.now(), kind, text, tx }, ...a.chain.log].slice(0, 60);
}

export function createAgent(input: NewAgent) {
  ensureFleet();
  const id = Math.random().toString(36).slice(2, 8);
  const { launchOnFuji, funding, owner, ...cfg } = input;
  const walletPk = generatePrivateKey();
  // Browser funding needs no server key for funding; agentic funding needs the operator wallet.
  const launch = launchOnFuji && (funding === "browser" || hasChain());
  const a: FleetAgent = {
    ...cfg,
    walletPk,
    hwm: cfg.budget,
    feesPaid: 0,
    chain: { enabled: launch, status: launch ? (funding === "browser" ? "awaiting_funds" : "launching") : "off", funding, owner, wallet: privateKeyToAccount(walletPk).address, agentId: null, mandateHash: mandateHash({ ...cfg.mandate, budget: cfg.budget, model: cfg.model, validator: cfg.validator }), paidUsdc: 0, payments: 0, feedbacks: 0, log: [], error: null },
    id,
    status: launch ? "paused" : "running",
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
  if (launch) void launchOnChain(a);
  else tick().catch(() => null);
  return a;
}

/**
 * Launch on Avalanche Fuji: fund the agent wallet, register its ERC-8004 identity
 * from its own wallet (model + mandate hash in metadata), top it up with USDC for x402.
 * The agent starts trading only after the identity exists.
 */
async function launchOnChain(a: FleetAgent) {
  const c = a.chain;
  try {
    chainLog(a, "info", `Ajan cüzdanı oluşturuldu: ${c.wallet}`);
    if (c.funding === "browser") {
      // The user's wallet sends AVAX (+ USDC) from the browser; wait until it lands.
      c.status = "awaiting_funds";
      chainLog(a, "info", "Cüzdanından ajan cüzdanına fon bekleniyor (AVAX gas + USDC x402)...");
      save();
      const deadline = Date.now() + 10 * 60_000;
      let b = await balances(c.wallet);
      while (b.avax < 0.01 && Date.now() < deadline) {
        await new Promise((r) => setTimeout(r, 4000));
        b = await balances(c.wallet).catch(() => b);
      }
      if (b.avax < 0.01) throw new Error("10 dakika içinde ajan cüzdanına AVAX gelmedi");
      chainLog(a, "fund", `Cüzdanından fon geldi: ${b.avax.toFixed(3)} AVAX · ${b.usdc.toFixed(2)} USDC`);
      c.status = "launching";
      save();
    } else {
      const fundTx = await fundAvax(c.wallet, process.env.FUJI_AGENT_GAS_AVAX || "0.02");
      chainLog(a, "fund", "Agentic wallet → ajan cüzdanı 0.02 AVAX (gas)", txUrl(fundTx));
      save();
    }

    const card = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: `Aviax · ${a.name}`,
      description: "Prediction-native spot trading agent. Decisions come from decision models as probability distributions.",
      services: [{ name: "aviax-decision-cycle", endpoint: "/api/x402/cycle", payment: { protocol: "x402", network: "avalanche-fuji", asset: "USDC", price: CYCLE_PRICE_USDC } }],
      owner: c.owner,
      model: a.model,
      validator: a.validator,
      mandate: { ...a.mandate, budgetUsdt: a.budget },
      mandateHash: c.mandateHash,
      supportedTrust: ["reputation"],
    };
    const reg = await registerAgent(a.walletPk, card, { model: a.model, validator: a.validator, mandateHash: c.mandateHash ?? "", ...(c.owner ? { owner: c.owner } : {}) });
    c.agentId = reg.agentId;
    chainLog(a, "register", `ERC-8004 kimliği alındı: agentId #${reg.agentId} (yetki hash'i metadata'da)`, txUrl(reg.hash));
    save();

    if (c.funding === "agentic") {
      const topUp = Number(process.env.FUJI_AGENT_USDC || 0.2);
      try {
        const usdcTx = await fundUsdc(c.wallet, topUp);
        chainLog(a, "fund", `Agentic wallet → ajan ${topUp} USDC (x402 ödemeleri için)`, txUrl(usdcTx));
      } catch (e) {
        chainLog(a, "error", `USDC gönderilemedi: ${(e as Error).message.slice(0, 120)}. x402 için agentic wallet'a Fuji USDC lazım.`);
      }
    }
    c.status = "registered";
    a.status = "running";
    a.nextRunAt = Date.now();
    save();
    tick().catch(() => null);
  } catch (e) {
    const msg = (e as Error).message;
    c.status = "failed";
    c.error = /insufficient funds|exceeds balance/i.test(msg)
      ? c.funding === "agentic"
        ? "Agentic wallet'ta yeterli Fuji AVAX yok. Faucet'ten AVAX gönderip tekrar dene."
        : "Ajan cüzdanında gas için yeterli AVAX yok."
      : msg.slice(0, 200);
    chainLog(a, "error", `Fuji fırlatma başarısız: ${c.error}`);
    save();
  }
}

export async function retryLaunch(id: string) {
  const a = store.agents.get(id);
  if (!a || a.chain.status === "registered") return;
  a.chain.status = "launching";
  a.chain.error = null;
  save();
  void launchOnChain(a);
}

export async function agentAction(id: string, action: "start" | "pause" | "close" | "delete" | "run" | "launch") {
  const a = store.agents.get(id);
  if (!a) throw new Error("agent not found");
  if (action === "launch") return retryLaunch(id);
  if ((action === "start" || action === "run") && a.chain.enabled && a.chain.status !== "registered") throw new Error("Ajan önce Fuji'de kaydedilmeli");
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
  if (agents.length === 0) return;

  for (const a of agents) {
    if (store.busy.has(a.id)) continue;
    if (a.position) {
      await trackPosition(a).catch(() => null);
      continue;
    }
    if (a.status !== "running") continue;
    if (a.execution === "okx" && !hasOkxKeys()) continue;
    if (Date.now() < a.nextRunAt) {
      if (a.phase !== "error") a.phase = a.runs > 0 ? "cooldown" : "idle";
      continue;
    }
    if (available(a) < 5) {
      a.lastError = "Bütçe tükendi";
      a.status = "paused";
      save();
      continue;
    }
    // Mandate: drawdown stop and daily trade cap.
    if (equity(a) <= a.budget * (1 - a.mandate.maxDrawdownPct / 100)) {
      a.lastError = `Maks. zarar limiti (%${a.mandate.maxDrawdownPct}) aşıldı, ajan durduruldu.`;
      a.status = "paused";
      save();
      continue;
    }
    if (tradesToday(a) >= a.mandate.maxDailyTrades) {
      a.lastVerdict = "limit";
      a.nextRunAt = Date.now() + a.intervalSec * 1000;
      continue;
    }
    void cycle(a);
  }
}

const FEE = 0.001; // OKX spot taker fee per side, used when the exact fill is not available

/** Market-sells the agent's spot quantity after cancelling its OCO. Returns the fill price. */
const isPaper = (t: Trade) => Boolean(t.algoId?.startsWith("paper"));

async function exitPosition(t: Trade) {
  if (isPaper(t)) {
    const tk = await getTicker(t.instId);
    return Number(tk.bidPx) || Number(tk.last);
  }
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
  } else if (isPaper(t)) {
    // Simulated OCO: trigger on the live price, fill at the trigger level.
    if (last >= t.tp) {
      exit = t.tp;
      reason = "tp";
    } else if (last <= t.sl) {
      exit = t.sl;
      reason = "sl";
    }
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
  // Success fee: charged only on equity above the high-water mark. Losses cost nothing,
  // and no fee is taken again until earlier losses are recovered.
  const eqAfter = a.budget + a.realizedPnl;
  let fee = 0;
  if (eqAfter > a.hwm) {
    fee = (eqAfter - a.hwm) * SUCCESS_FEE;
    a.realizedPnl -= fee;
    a.feesPaid += fee;
    a.hwm = eqAfter - fee;
    t.fee = fee;
    chainLog(a, "info", `Başarı ücreti %${Math.round(SUCCESS_FEE * 100)}: ${fee.toFixed(4)} USDT (yeni zirve ${a.hwm.toFixed(2)})`);
  }
  a.trades = [t, ...a.trades].slice(0, 50);
  if (a.chain.status === "registered" && a.chain.agentId) {
    const pnlPct = (pnl / (t.entry * qty)) * 100;
    const agentId = a.chain.agentId;
    giveFeedback(agentId, pnlPct, t.instId, { instId: t.instId, entry: t.entry, exit, qty: t.qty, pnl, successFee: fee, hwm: a.hwm, reason, openedAt: t.openedAt, closedAt: t.closedAt })
      .then((h) => {
        a.chain.feedbacks += 1;
        chainLog(a, "reputation", `ERC-8004 itibar: ${t.instId} ${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}% (${reason})`, txUrl(h));
        save();
      })
      .catch((e) => {
        chainLog(a, "error", `İtibar kaydı başarısız: ${(e as Error).message.slice(0, 120)}`);
        save();
      });
  }
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

  // x402: the agent pays for its decision cycle before it may run.
  if (a.chain.status === "registered") {
    const t0 = Date.now();
    a.events.push(Object.assign({ type: "log", tone: "info", tool: "x402", text: `Karar turu ücreti: ${CYCLE_PRICE_USDC} USDC · 402 → EIP-3009 imza → Fuji settle` } as AgentEvent, { ts: t0 }));
    try {
      const port = process.env.PORT || "3000";
      const { res, paid } = await payAndFetch(`http://localhost:${port}/api/x402/cycle?agent=${a.id}`, a.walletPk);
      if (!res.ok || !paid) {
        const j = await res.json().catch(() => ({}));
        throw new Error((j as { error?: string }).error || `HTTP ${res.status}`);
      }
      a.chain.payments += 1;
      a.chain.paidUsdc += paid.amount ?? CYCLE_PRICE_USDC;
      chainLog(a, "x402", `x402 ödeme ${CYCLE_PRICE_USDC} USDC (tur ${a.runs})`, txUrl(paid.transaction));
      a.events.push(Object.assign({ type: "log", tone: "ok", tool: "x402", text: `Ödeme settle edildi (${((Date.now() - t0) / 1000).toFixed(1)}s): ${paid.transaction.slice(0, 18)}…` } as AgentEvent, { ts: Date.now() }));
    } catch (e) {
      const bal = await usdcBalance(a.chain.wallet).catch(() => 0);
      const msg = bal < CYCLE_PRICE_USDC ? `Ajan cüzdanında USDC yok (${bal}). x402 ödemesi yapılamadı, tur atlandı.` : `x402 ödemesi başarısız: ${(e as Error).message.slice(0, 140)}`;
      a.lastError = msg;
      a.lastVerdict = "error";
      chainLog(a, "error", msg);
      a.events.push(Object.assign({ type: "log", tone: "err", text: msg } as AgentEvent, { ts: Date.now() }), Object.assign({ type: "done", ms: 0, verdict: "error" } as AgentEvent, { ts: Date.now() }));
      a.phase = "error";
      a.nextRunAt = Date.now() + a.intervalSec * 1000;
      store.busy.delete(a.id);
      save();
      return;
    }
  }
  let plan: Plan | null = null;
  let ordId: string | undefined;
  let fill: { algoId?: string; qty?: string; avgPx?: number } = {};
  let ok = false;
  try {
    for await (const ev of runAgent({
      execute: true,
      universe: a.universe,
      model: a.model,
      validator: a.validator,
      openrouterKey: a.openrouterKey,
      allowed: a.mandate.allowed,
      maxTradeUsdt: a.mandate.maxTradeUsdt,
      minGate: a.mandate.minGate,
      budget: available(a),
      maxLeverage: a.maxLeverage,
      exclude: held,
      strict: a.model !== "shadow",
      tag: `av${a.id}`,
      paper: a.execution === "paper",
    })) {
      a.events.push(Object.assign({}, ev, { ts: Date.now() }));
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
