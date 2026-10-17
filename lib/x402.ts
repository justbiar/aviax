import { getAddress, parseSignature, toHex, verifyTypedData, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { FUJI, USDC_ABI, operatorAccount, operatorPk, publicClient, walletFor } from "./chain";

/**
 * x402 (exact scheme, EVM) on Avalanche Fuji with USDC (EIP-3009).
 * The decision service answers 402 until the agent attaches a signed
 * TransferWithAuthorization; our server acts as facilitator and settles on-chain.
 */

export const X402_NETWORK = "avalanche-fuji";
/** Per-cycle decision price: covers model inference + settlement, paid win or lose. */
/** x402 cycle payments can be paused (X402_ENABLED=1 to turn them on). */
export const X402_ENABLED = () => process.env.X402_ENABLED === "1";
export const CYCLE_PRICE_USDC = Number(process.env.X402_CYCLE_PRICE_USDC || 0.001);

export type PaymentRequirements = {
  scheme: "exact";
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  payTo: Hex;
  maxTimeoutSeconds: number;
  asset: Hex;
  extra: { name: string; version: string };
};

export function requirements(resource: string, priceUsdc = CYCLE_PRICE_USDC, payTo?: Hex, description = "Aviax decision cycle: market scan + JEV/LAYA decisions"): PaymentRequirements {
  return {
    scheme: "exact",
    network: X402_NETWORK,
    maxAmountRequired: String(Math.round(priceUsdc * 1e6)),
    resource,
    description,
    mimeType: "application/json",
    payTo: payTo ?? operatorAccount().address,
    maxTimeoutSeconds: 120,
    asset: FUJI.usdc,
    extra: { name: "USD Coin", version: "2" },
  };
}

const TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

const domain = (r: PaymentRequirements) => ({ name: r.extra.name, version: r.extra.version, chainId: 43113, verifyingContract: r.asset });

type Authorization = { from: Hex; to: Hex; value: string; validAfter: string; validBefore: string; nonce: Hex };
type PaymentPayload = { x402Version: 1; scheme: "exact"; network: string; payload: { signature: Hex; authorization: Authorization } };

/** Client side: the agent signs an EIP-3009 authorization and encodes the X-PAYMENT header. */
export async function createPaymentHeader(agentPk: Hex, r: PaymentRequirements) {
  const account = privateKeyToAccount(agentPk);
  const now = Math.floor(Date.now() / 1000);
  const authorization: Authorization = {
    from: account.address,
    to: r.payTo,
    value: r.maxAmountRequired,
    validAfter: String(now - 60),
    validBefore: String(now + r.maxTimeoutSeconds),
    nonce: toHex(crypto.getRandomValues(new Uint8Array(32))),
  };
  const signature = await account.signTypedData({
    domain: domain(r),
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: { ...authorization, value: BigInt(authorization.value), validAfter: BigInt(authorization.validAfter), validBefore: BigInt(authorization.validBefore) },
  });
  const payload: PaymentPayload = { x402Version: 1, scheme: "exact", network: r.network, payload: { signature, authorization } };
  return Buffer.from(JSON.stringify(payload)).toString("base64");
}

/** Facilitator side: verify the signed authorization, then settle it on Fuji. */
export async function verifyAndSettle(header: string, r: PaymentRequirements) {
  const p = JSON.parse(Buffer.from(header, "base64").toString()) as PaymentPayload;
  const a = p.payload.authorization;
  if (p.scheme !== "exact" || p.network !== r.network) throw new Error("unsupported scheme/network");
  if (getAddress(a.to) !== getAddress(r.payTo)) throw new Error("wrong recipient");
  if (BigInt(a.value) < BigInt(r.maxAmountRequired)) throw new Error("amount too low");
  const now = Math.floor(Date.now() / 1000);
  if (Number(a.validBefore) < now + 5 || Number(a.validAfter) > now) throw new Error("authorization expired");
  const ok = await verifyTypedData({
    address: a.from,
    domain: domain(r),
    types: TYPES,
    primaryType: "TransferWithAuthorization",
    message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
    signature: p.payload.signature,
  });
  if (!ok) throw new Error("invalid signature");
  const bal = await publicClient.readContract({ address: r.asset, abi: USDC_ABI, functionName: "balanceOf", args: [a.from] });
  if (bal < BigInt(a.value)) throw new Error("payer has insufficient USDC");

  const { v, r: sr, s, yParity } = parseSignature(p.payload.signature);
  const hash = await walletFor(operatorPk() as Hex).writeContract({
    address: r.asset,
    abi: USDC_ABI,
    functionName: "transferWithAuthorization",
    args: [a.from, a.to, BigInt(a.value), BigInt(a.validAfter), BigInt(a.validBefore), a.nonce, Number(v ?? BigInt(27 + (yParity ?? 0))), sr, s],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== "success") throw new Error(`settlement reverted: ${hash}`);
  return { txHash: hash, payer: a.from, amount: Number(a.value) / 1e6 };
}

/** Client helper: call a paid endpoint, pay on 402, retry with X-PAYMENT. */
export async function payAndFetch(url: string, agentPk: Hex) {
  const first = await fetch(url, { cache: "no-store" });
  if (first.status !== 402) return { res: first, paid: null };
  const body = (await first.json()) as { accepts: PaymentRequirements[] };
  const req = body.accepts[0];
  const header = await createPaymentHeader(agentPk, req);
  const res = await fetch(url, { headers: { "X-PAYMENT": header }, cache: "no-store" });
  const settle = res.headers.get("X-PAYMENT-RESPONSE");
  const paid = settle ? (JSON.parse(Buffer.from(settle, "base64").toString()) as { success: boolean; transaction: Hex; payer: Hex; amount: number }) : null;
  return { res, paid };
}
