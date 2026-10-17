import crypto from "node:crypto";

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

async function request<T>(method: "GET" | "POST", path: string, opts: { query?: Record<string, string | number | undefined>; body?: unknown; auth?: boolean } = {}): Promise<T> {
  const qs = opts.query
    ? "?" + new URLSearchParams(Object.entries(opts.query).filter(([, v]) => v !== undefined && v !== "").map(([k, v]) => [k, String(v)])).toString()
    : "";
  const requestPath = path + (qs === "?" ? "" : qs);
  const body = opts.body ? JSON.stringify(opts.body) : "";
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isDemo()) headers["x-simulated-trading"] = "1";
  if (opts.auth) {
    if (!hasOkxKeys()) throw new OkxError("NO_KEYS", "OKX API keys are missing in .env.local");
    const ts = new Date().toISOString();
    const sign = crypto
      .createHmac("sha256", process.env.OKX_SECRET_KEY!)
      .update(ts + method + requestPath + body)
      .digest("base64");
    headers["OK-ACCESS-KEY"] = process.env.OKX_API_KEY!;
    headers["OK-ACCESS-SIGN"] = sign;
    headers["OK-ACCESS-TIMESTAMP"] = ts;
    headers["OK-ACCESS-PASSPHRASE"] = process.env.OKX_PASSPHRASE!;
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

export const getBalance = async () =>
  (await request<{ totalEq: string; details: { ccy: string; eq: string; availBal: string; upl: string }[] }[]>("GET", "/api/v5/account/balance", { auth: true }))[0];

export type Position = { instId: string; posSide: string; pos: string; avgPx: string; markPx: string; upl: string; uplRatio: string; lever: string; liqPx: string; notionalUsd: string; margin: string; cTime: string };
export const getPositions = () => request<Position[]>("GET", "/api/v5/account/positions", { auth: true, query: { instType: "SWAP" } });

export type Order = { ordId: string; instId: string; side: string; ordType: string; px: string; sz: string; accFillSz: string; state: string; cTime: string; avgPx: string; lever: string };
export const getOpenOrders = () => request<Order[]>("GET", "/api/v5/trade/orders-pending", { auth: true, query: { instType: "SWAP" } });
export const getOrderHistory = () => request<Order[]>("GET", "/api/v5/trade/orders-history", { auth: true, query: { instType: "SWAP", limit: 30 } });

export const getAlgoOrders = () =>
  request<{ algoId: string; instId: string; tpTriggerPx: string; slTriggerPx: string; sz: string; side: string; state: string }[]>("GET", "/api/v5/trade/orders-algo-pending", {
    auth: true,
    query: { ordType: "oco,conditional", instType: "SWAP" },
  });

export const getAccountConfig = async () =>
  (await request<{ posMode: "net_mode" | "long_short_mode"; acctLv: string }[]>("GET", "/api/v5/account/config", { auth: true }))[0];

export const setLeverage = (instId: string, lever: number, mgnMode: "cross" | "isolated" = "cross") =>
  request("POST", "/api/v5/account/set-leverage", { auth: true, body: { instId, lever: String(lever), mgnMode } });

export type PlaceOrderInput = {
  instId: string;
  side: "buy" | "sell";
  ordType: "market" | "limit";
  sz: string; // contracts
  px?: string;
  tdMode?: "cross" | "isolated";
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
      tdMode: o.tdMode ?? "cross",
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
