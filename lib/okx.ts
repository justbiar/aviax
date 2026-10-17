import crypto from "node:crypto";
import type { OkxCredentials } from "./companySession";

const BASE = "https://www.okx.com";

export const hasOkxKeys = () =>
  Boolean(process.env.OKX_API_KEY && process.env.OKX_SECRET_KEY && process.env.OKX_PASSPHRASE);

const isDemo = () => process.env.OKX_DEMO !== "0";

type OkxResp<T> = { code: string; msg: string; data: T };

export class OkxError extends Error {
  constructor(public code: string, message: string, public data?: unknown) {
    super(message);
  }
}

async function request<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean; credentials?: OkxCredentials } = {}): Promise<T> {
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString()
    : "";
  const requestPath = path + (qs === "?" ? "" : qs);
  const body = opts.body ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isDemo() || opts.credentials) headers["x-simulated-trading"] = "1";
  if (opts.auth) {
    const apiKey = opts.credentials?.apiKey ?? process.env.OKX_API_KEY;
    const secretKey = opts.credentials?.secretKey ?? process.env.OKX_SECRET_KEY;
    const passphrase = opts.credentials?.passphrase ?? process.env.OKX_PASSPHRASE;
    if (!apiKey || !secretKey || !passphrase) throw new OkxError("NO_KEYS", "OKX demo API bilgileri eksik");
    const ts = new Date().toISOString();
    const sign = crypto
      .createHmac("sha256", secretKey)
      .update(ts + method + requestPath + body)
      .digest("base64");
    headers["OK-ACCESS-KEY"] = apiKey;
    headers["OK-ACCESS-SIGN"] = sign;
    headers["OK-ACCESS-TIMESTAMP"] = ts;
    headers["OK-ACCESS-PASSPHRASE"] = passphrase;
  }

  const res = await fetch(BASE + requestPath, { method, headers, body: body || undefined, cache: "no-store" });
  const json = (await res.json()) as OkxResp<T>;
  if (json.code !== "0") {
    const detail = Array.isArray(json.data) ? (json.data as Array<{ sMsg?: string }>).map((d) => d.sMsg).filter(Boolean).join("; ") : "";
    throw new OkxError(json.code, detail || json.msg || "OKX request failed", json.data);
  }
  return json.data;
}

/* ---------- public market data ---------- */

export type Ticker = { instId: string; last: string; open24h: string; high24h: string; low24h: string; volCcy24h: string; vol24h: string; bidPx: string; askPx: string; ts: string };

export const getTicker = async (instId: string) => (await request<Ticker[]>("GET", "/api/v5/market/ticker", { query: { instId } }))[0];
export const getTickers = (instType: "SWAP" | "SPOT" = "SWAP") => request<Ticker[]>("GET", "/api/v5/market/tickers", { query: { instType } });

/** [ts, o, h, l, c, vol, volCcy, volCcyQuote, confirm] newest first */
export const getCandles = (instId: string, bar = "15m", limit = 200) =>
  request<string[][]>("GET", "/api/v5/market/candles", { query: { instId, bar, limit } });

export const getOrderbook = async (instId: string, sz = 20) =>
  (await request<{ asks: string[][]; bids: string[][]; ts: string }[]>("GET", "/api/v5/market/books", { query: { instId, sz } }))[0];

export const getTrades = (instId: string, limit = 30) =>
  request<{ px: string; sz: string; side: "buy" | "sell"; ts: string; tradeId: string }[]>("GET", "/api/v5/market/trades", { query: { instId, limit } });

export const getFundingRate = async (instId: string) =>
  (await request<{ fundingRate: string; nextFundingTime: string }[]>("GET", "/api/v5/public/funding-rate", { query: { instId } }))[0];

export type Instrument = { instId: string; ctVal: string; lotSz: string; minSz: string; tickSz: string; lever: string };
const instCache = new Map<string, Instrument>();
export async function getInstrument(instId: string) {
  if (instCache.has(instId)) return instCache.get(instId)!;
  const instType = instId.endsWith("-SWAP") ? "SWAP" : "SPOT";
  const [inst] = await request<Instrument[]>("GET", "/api/v5/public/instruments", { query: { instType, instId } });
  instCache.set(instId, inst);
  return inst;
}

/* ---------- private account / trading ---------- */

export const getBalance = async (credentials?: OkxCredentials) =>
  (await request<{ totalEq: string; details: { ccy: string; eq: string; availBal: string; upl: string; eqUsd?: string }[] }[]>("GET", "/api/v5/account/balance", { auth: true, credentials }))[0];

export type Position = { instId: string; posSide: string; pos: string; avgPx: string; markPx: string; upl: string; uplRatio: string; lever: string; liqPx: string; notionalUsd: string; margin: string; cTime: string };
export const getPositions = () => request<Position[]>("GET", "/api/v5/account/positions", { auth: true, query: { instType: "SWAP" } });

export type Order = { ordId: string; instId: string; side: string; ordType: string; px: string; sz: string; accFillSz: string; state: string; cTime: string; avgPx: string; lever: string };
export const getOpenOrders = (credentials?: OkxCredentials) => request<Order[]>("GET", "/api/v5/trade/orders-pending", { auth: true, credentials, query: { instType: "SPOT" } });
export const getOrderHistory = (credentials?: OkxCredentials) => request<Order[]>("GET", "/api/v5/trade/orders-history", { auth: true, credentials, query: { instType: "SPOT", limit: 30 } });

export const getOrder = async (instId: string, ordId: string) =>
  (await request<(Order & { fee: string; feeCcy: string; fillPx: string })[]>("GET", "/api/v5/trade/order", { auth: true, query: { instId, ordId } }))[0];

export const getAlgoOrders = () =>
  request<{ algoId: string; instId: string; tpTriggerPx: string; slTriggerPx: string; sz: string; side: string; state: string }[]>("GET", "/api/v5/trade/orders-algo-pending", {
    auth: true,
    query: { ordType: "oco,conditional", instType: "SPOT" },
  });

export type AlgoOrder = { algoId: string; instId: string; state: string; actualPx: string; actualSide: string; actualSz: string; tpTriggerPx: string; slTriggerPx: string; sz: string };
/** state: live | effective (triggered) | canceled | order_failed | partially_effective */
export const getAlgoOrder = async (algoId: string) => (await request<AlgoOrder[]>("GET", "/api/v5/trade/order-algo", { auth: true, query: { algoId } }))[0];
export const cancelAlgo = (instId: string, algoId: string) => request("POST", "/api/v5/trade/cancel-algos", { auth: true, body: [{ instId, algoId }] });

export const getAccountConfig = async () =>
  (await request<{ posMode: "net_mode" | "long_short_mode"; acctLv: string }[]>("GET", "/api/v5/account/config", { auth: true }))[0];

export const setLeverage = (instId: string, lever: number, mgnMode: "cross" | "isolated" = "cross") =>
  request("POST", "/api/v5/account/set-leverage", { auth: true, body: { instId, lever: String(lever), mgnMode } });

export type PlaceOrderInput = {
  instId: string;
  side: "buy" | "sell";
  ordType: "market" | "limit";
  sz: string; // spot: base amount, or quote amount when tgtCcy=quote_ccy
  px?: string;
  tdMode?: "cash" | "cross" | "isolated";
  tgtCcy?: "base_ccy" | "quote_ccy";
  reduceOnly?: boolean;
  posSide?: "long" | "short";
  tpTriggerPx?: string;
  slTriggerPx?: string;
};

export async function placeOrder(o: PlaceOrderInput) {
  const attachAlgoOrds =
    o.tpTriggerPx || o.slTriggerPx
      ? [{ tpTriggerPx: o.tpTriggerPx, tpOrdPx: o.tpTriggerPx ? "-1" : undefined, slTriggerPx: o.slTriggerPx, slOrdPx: o.slTriggerPx ? "-1" : undefined }]
      : undefined;
  return request<{ ordId: string; sCode: string; sMsg: string }[]>("POST", "/api/v5/trade/order", {
    auth: true,
    body: {
      instId: o.instId,
      tdMode: o.tdMode ?? "cash",
      tgtCcy: o.tgtCcy,
      side: o.side,
      posSide: o.posSide,
      ordType: o.ordType,
      sz: o.sz,
      px: o.ordType === "limit" ? o.px : undefined,
      reduceOnly: o.reduceOnly ? "true" : undefined,
      attachAlgoOrds,
    },
  });
}

export const cancelOrder = (instId: string, ordId: string) => request("POST", "/api/v5/trade/cancel-order", { auth: true, body: { instId, ordId } });

export const closePosition = (instId: string, mgnMode: "cross" | "isolated" = "cross") =>
  request("POST", "/api/v5/trade/close-position", { auth: true, body: { instId, mgnMode, autoCxl: true } });

/** Converts a USDT notional into a valid contract count for a swap. */
export async function notionalToContracts(instId: string, notionalUsdt: number, price: number) {
  const inst = await getInstrument(instId);
  const ctVal = Number(inst.ctVal);
  const lot = Number(inst.lotSz);
  const raw = notionalUsdt / (price * ctVal);
  const contracts = Math.max(Number(inst.minSz), Math.floor(raw / lot) * lot);
  const decimals = (inst.lotSz.split(".")[1] ?? "").length;
  return contracts.toFixed(decimals);
}

export const roundToTick = async (instId: string, px: number) => {
  const inst = await getInstrument(instId);
  const tick = Number(inst.tickSz);
  const decimals = (inst.tickSz.split(".")[1] ?? "").length;
  return (Math.round(px / tick) * tick).toFixed(decimals);
};

export const getPositionsHistory = (instId: string) =>
  request<{ instId: string; realizedPnl: string; pnl: string; fee: string; openAvgPx: string; closeAvgPx: string; uTime: string; cTime: string; direction: string }[]>(
    "GET",
    "/api/v5/account/positions-history",
    { auth: true, query: { instType: "SWAP", instId, limit: 10 } },
  );

/** Rounds a base amount down to the instrument's lot size (spot). */
export async function roundLot(instId: string, qty: number) {
  const inst = await getInstrument(instId);
  const lot = Number(inst.lotSz);
  const decimals = (inst.lotSz.split(".")[1] ?? "").length;
  return (Math.floor(qty / lot + 1e-9) * lot).toFixed(decimals);
}
