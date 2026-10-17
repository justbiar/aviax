import fs from "node:fs";
import path from "node:path";
import type { Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { runAgent, type AgentEvent, type Plan } from "./agent";
import { balances, fundAvax, giveFeedback, hasChain, mandateHash, registerAgent, txUrl, usdcBalance } from "./chain";
import { CYCLE_PRICE_USDC } from "./x402";
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
  /** Company treasury decision agents are identity-only and never enter the trading scheduler. */
  decisionOnly?: boolean;
  companyName?: string;
  companyPolicyHash?: Hex;
  companyDecisionEndpoint?: string;
  model: string;
  /** second-opinion model in the LAYA seat */
  validator: string;
  /** bring-your-own OpenRouter key (never sent to the client) */
  openrouterKey?: string;
  mandate: Mandate;
  /** marketplace: others pay per signal via x402; the owner uses the agent for free */
  listing: { enabled: boolean; priceUsdc: number; sales: number; revenueUsdc: number; lastBuyer: string | null };
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
  decisionOnly?: boolean;
  companyName?: string;
  companyPolicyHash?: Hex;
  companyDecisionEndpoint?: string;
};

type Store = { agents: Map<string, FleetAgent>; busy: Set<string>; timer?: NodeJS.Timeout; loaded: boolean; tick?: () => Promise<void> };
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
  a.listing ??= { enabled: false, priceUsdc: 0.01, sales: 0, revenueUsdc: 0, lastBuyer: null };
  // Owners no longer pay per cycle: drop stale per-cycle x402 errors from older runs.
  if (a.lastError && /x402 ödemesi/.test(a.lastError)) {
    a.lastError = null;
    if (a.phase === "error") a.phase = "cooldown";
  }
  // Older versions tried to prefund an owner's agent wallet with USDC even though
  // only marketplace buyers pay x402. Hide that obsolete launch warning on reload.
  a.chain.log = (a.chain.log ?? []).filter((entry) => !/USDC gönderilemedi:.*x402 için|x402 ödemesi yapılamadı/i.test(entry.text));
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
  // A timer created by an older module version calls stale code: replace it once.
  if (store.timer && !store.tick) {
    clearInterval(store.timer);
    store.timer = undefined;
  }
  // The timer always calls the latest tick, so code reloads take effect immediately.
  store.tick = tick;
  if (!store.timer) store.timer = setInterval(() => store.tick?.().catch(() => null), 5000);
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
    listing: { enabled: false, priceUsdc: 0.01, sales: 0, revenueUsdc: 0, lastBuyer: null },
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
 * Launch on Avalanche Fuji: fund gas and register its ERC-8004 identity.
 * The owner runs their agent for free; x402 is paid by marketplace buyers directly.
 * The agent starts trading only after the identity exists.
 */
async function launchOnChain(a: FleetAgent) {
  const c = a.chain;
  try {
    chainLog(a, "info", `Ajan cüzdanı oluşturuldu: ${c.wallet}`);
    if (c.funding === "browser") {
      // The user's wallet sends only the AVAX needed for registration gas.
      c.status = "awaiting_funds";
      chainLog(a, "info", "Cüzdanından ajan cüzdanına Fuji gas için AVAX bekleniyor...");
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
      // A retry after a failed register must not fund the agent wallet a second time.
      const have = await balances(c.wallet).catch(() => ({ avax: 0, usdc: 0 }));
      if (have.avax >= 0.01) {
        chainLog(a, "info", `Ajan cüzdanında yeterli gas var (${have.avax.toFixed(3)} AVAX), yeniden fonlanmadı`);
      } else {
        const fundTx = await fundAvax(c.wallet, process.env.FUJI_AGENT_GAS_AVAX || "0.02");
        chainLog(a, "fund", "Agentic wallet → ajan cüzdanı 0.02 AVAX (gas)", txUrl(fundTx));
      }
      save();
    }

    const card = {
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: a.companyName ? `Aviax · ${a.companyName} · ${a.name}` : `Aviax · ${a.name}`,
      description: a.decisionOnly ? `Company treasury decision agent for ${a.companyName}. It evaluates the company's OKX portfolio and policy; it does not place trades.` : "Prediction-native spot trading agent. Decisions come from decision models as probability distributions.",
      services: a.decisionOnly
        ? [{ name: "aviax-company-decision", endpoint: a.companyDecisionEndpoint ?? `/api/company/decision/${a.id}`, payment: { protocol: "x402", network: "avalanche-fuji", asset: "USDC", price: "set by company" } }]
        : [{ name: "aviax-signal", endpoint: `/api/signal/${a.id}`, payment: { protocol: "x402", network: "avalanche-fuji", asset: "USDC", price: "set by owner when listed" } }],
      owner: c.owner,
      company: a.companyName,
      model: a.model,
      validator: a.validator,
      mandate: { ...a.mandate, budgetUsdt: a.budget },
      mandateHash: c.mandateHash,
      companyPolicyHash: a.companyPolicyHash,
      supportedTrust: ["reputation"],
    };
    const reg = await registerAgent(a.walletPk, card, { model: a.model, validator: a.validator, mandateHash: c.mandateHash ?? "", ...(a.companyName ? { company: a.companyName } : {}), ...(a.companyPolicyHash ? { companyPolicyHash: a.companyPolicyHash } : {}), ...(c.owner ? { owner: c.owner } : {}) });
    c.agentId = reg.agentId;
    chainLog(a, "register", `ERC-8004 kimliği alındı: agentId #${reg.agentId} (yetki hash'i metadata'da)`, txUrl(reg.hash));
    save();

    c.status = "registered";
    if (a.decisionOnly) {
      a.status = "paused";
      save();
      return;
    }
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

/** Owner lists (or unlists) the agent's signals for sale over x402. */
export function setListing(id: string, enabled: boolean, priceUsdc?: number) {
  const a = store.agents.get(id);
  if (!a) throw new Error("agent not found");
  if (a.decisionOnly) throw new Error("Şirket karar ajanı pazarda senaryo çalıştırmaz");
  if (enabled && a.chain.status !== "registered") throw new Error("Pazara açmak için ajan önce Fuji'de ERC-8004 kimliği almalı");
  a.listing.enabled = enabled;
  if (priceUsdc !== undefined) a.listing.priceUsdc = Math.min(10, Math.max(0.001, priceUsdc));
  chainLog(a, "info", enabled ? `Pazara açıldı: senaryo başına ${a.listing.priceUsdc} USDC (x402)` : "Pazardan çekildi");
  save();
}

/** Latest decision of an agent, as sold to signal buyers. */
export function latestSignal(id: string) {
  const a = store.agents.get(id);
  if (!a) return null;
  const ev = a.events;
  const find = <T extends AgentEvent["type"]>(t: T) => ev.filter((e) => e.type === t) as Extract<AgentEvent, { type: T }>[];
  const decisions = Object.fromEntries(find("decision").map((d) => [d.key, { pick: d.pick, jev: d.jev.probabilities, laya: d.laya.probabilities }]));
  const plan = find("plan")[0]?.plan ?? null;
  const done = find("done")[0] ?? null;
  return {
    agent: { id: a.id, name: a.name, erc8004: a.chain.agentId, model: a.model, validator: a.validator },
    at: (ev[0] as { ts?: number } | undefined)?.ts ?? null,
    verdict: done?.verdict ?? "running",
    decisions,
    plan,
    position: a.position ? { instId: a.position.instId, entry: a.position.entry, tp: a.position.tp, sl: a.position.sl } : null,
    track: { trades: a.trades.length, wins: a.trades.filter((t) => (t.pnl ?? 0) > 0).length, realizedPnl: a.realizedPnl, budget: a.budget },
  };
}

export function recordSale(id: string, buyer: string, amount: number, tx: string) {
  const a = store.agents.get(id);
  if (!a) return;
  a.listing.sales += 1;
  a.listing.revenueUsdc += amount;
  a.listing.lastBuyer = buyer;
  chainLog(a, "x402", `x402 satış: ${amount} USDC · alıcı ${buyer.slice(0, 6)}…${buyer.slice(-4)}`, txUrl(tx));
  save();
}

export const getAgent = (id: string) => store.agents.get(id) ?? null;

/** The registered risk desk identity of a company, used by the desk to anchor its decisions. Server-only. */
export function deskSigner(companyName: string) {
  ensureFleet();
  const a = [...store.agents.values()].find((x) => x.decisionOnly && x.companyName === companyName && x.chain.status === "registered" && x.chain.agentId);
  return a ? { agentId: a.chain.agentId!, pk: a.walletPk as Hex, name: a.name } : null;
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
  if (a.decisionOnly && ["start", "run", "close"].includes(action)) throw new Error("Şirket karar ajanı trade işlemi yürütmez");
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
