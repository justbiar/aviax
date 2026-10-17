import { createPublicClient, createWalletClient, decodeEventLog, encodeAbiParameters, fallback, formatEther, formatUnits, http, keccak256, parseAbi, parseEther, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { avalancheFuji } from "viem/chains";
import { agenticWallet } from "./wallets";

/**
 * Avalanche Fuji layer: ERC-8004 identity + reputation (official v1 registries) and
 * Fuji USDC for x402 payments. The operator wallet (the user's agentic wallet, or the
 * FUJI_PRIVATE_KEY service wallet as fallback) pays gas, funds agents, acts as x402
 * facilitator and gives reputation feedback after every closed trade.
 */

export const FUJI = {
  identity: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputation: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  usdc: "0x5425890298aed601595a70AB815c96711a31Bc65",
  explorer: "https://testnet.snowtrace.io",
} as const;

export const txUrl = (h: string) => `${FUJI.explorer}/tx/${h}`;
export const addrUrl = (a: string) => `${FUJI.explorer}/address/${a}`;
export const agentUrl = (id: string | number) => `${FUJI.explorer}/nft/${FUJI.identity}/${id}`;

export const IDENTITY_ABI = parseAbi([
  "struct MetadataEntry { string metadataKey; bytes metadataValue; }",
  "function register(string agentURI, MetadataEntry[] metadata) returns (uint256)",
  "function setMetadata(uint256 agentId, string metadataKey, bytes metadataValue)",
  "function getMetadata(uint256 agentId, string metadataKey) view returns (bytes)",
  "function tokenURI(uint256 tokenId) view returns (string)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
]);

export const REPUTATION_ABI = parseAbi([
  "function giveFeedback(uint256 agentId, int128 value, uint8 valueDecimals, string tag1, string tag2, string endpoint, string feedbackURI, bytes32 feedbackHash)",
  "function getSummary(uint256 agentId, address[] clientAddresses, string tag1, string tag2) view returns (uint64, int128, uint8)",
]);

export const USDC_ABI = parseAbi([
  "function balanceOf(address) view returns (uint256)",
  "function transfer(address to, uint256 amount) returns (bool)",
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
]);

/** Operator key: the agentic wallet when one exists, otherwise the service wallet from env. */
export const operatorPk = (): Hex | null => (agenticWallet()?.pk ?? (process.env.FUJI_PRIVATE_KEY as Hex | undefined)) || null;
export const operatorKind = () => (agenticWallet() ? "agentic" : process.env.FUJI_PRIVATE_KEY ? "service" : "none");
export const hasChain = () => Boolean(operatorPk());

const transport = () => fallback([
  http(process.env.FUJI_RPC_URL || "https://api.avax-test.network/ext/bc/C/rpc"),
  // Public fallback keeps Fuji read/settlement available when the public Avalanche RPC rate-limits this host.
  http("https://avalanche-fuji-c-chain-rpc.publicnode.com"),
]);
export const publicClient = createPublicClient({ chain: avalancheFuji, transport: transport() });

export const operatorAccount = () => privateKeyToAccount(operatorPk() as Hex);
export const walletFor = (pk: Hex) => createWalletClient({ chain: avalancheFuji, transport: transport(), account: privateKeyToAccount(pk) });
const operatorWallet = () => walletFor(operatorPk() as Hex);

export async function balances(address: Hex) {
  const [avax, usdc] = await Promise.all([publicClient.getBalance({ address }), publicClient.readContract({ address: FUJI.usdc, abi: USDC_ABI, functionName: "balanceOf", args: [address] })]);
  return { avax: Number(formatEther(avax)), usdc: Number(formatUnits(usdc, 6)) };
}

export async function operatorStatus() {
  if (!hasChain()) return { configured: false as const, kind: "none" as const };
  const address = operatorAccount().address;
  return { configured: true as const, kind: operatorKind(), address, ...(await balances(address)) };
}

async function confirm(hash: Hex) {
  const r = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (r.status !== "success") throw new Error(`tx reverted: ${hash}`);
  return r;
}

/** Operator sends gas money (AVAX) to an agent wallet. */
export async function fundAvax(to: Hex, avax: string) {
  const hash = await operatorWallet().sendTransaction({ to, value: parseEther(avax), gas: 21_000n });
  await confirm(hash);
  return hash;
}

/** Operator sends USDC to an agent wallet for x402 payments. */
export async function fundUsdc(to: Hex, usdc: number) {
  const hash = await operatorWallet().writeContract({ address: FUJI.usdc, abi: USDC_ABI, functionName: "transfer", args: [to, BigInt(Math.round(usdc * 1e6))], gas: 120_000n });
  await confirm(hash);
  return hash;
}

export const usdcBalance = async (a: Hex) => Number(formatUnits(await publicClient.readContract({ address: FUJI.usdc, abi: USDC_ABI, functionName: "balanceOf", args: [a] }), 6));

/** Canonical hash of an agent mandate (limits). Same input always gives the same hash. */
export function mandateHash(mandate: Record<string, unknown>) {
  const canon = JSON.stringify(mandate, Object.keys(mandate).sort());
  return keccak256(toHex(canon));
}

/**
 * Registers the agent on the ERC-8004 Identity Registry from the agent's own wallet,
 * so the agent owns its identity NFT. Model and mandate hash go into on-chain metadata.
 */
export async function registerAgent(agentPk: Hex, card: Record<string, unknown>, meta: Record<string, string>) {
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(card)).toString("base64")}`;
  const metadata = Object.entries(meta).map(([metadataKey, v]) => ({ metadataKey, metadataValue: toHex(v) }));
  // Explicit gas limit: a fallback RPC returned a ~59e12 gas estimate for this call, which the
  // node then rejects as invalid. Registration with a data: URI card fits well under 3M.
  const hash = await walletFor(agentPk).writeContract({ address: FUJI.identity, abi: IDENTITY_ABI, functionName: "register", args: [uri, metadata], gas: 3_000_000n });
  const receipt = await confirm(hash);
  let agentId: string | null = null;
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== FUJI.identity.toLowerCase()) continue;
    try {
      const ev = decodeEventLog({ abi: IDENTITY_ABI, data: log.data, topics: log.topics });
      if (ev.eventName === "Registered") agentId = ev.args.agentId.toString();
    } catch {
      /* other events (Transfer, MetadataSet) */
    }
  }
  if (!agentId) throw new Error("Registered event not found");
  return { hash, agentId };
}

/**
 * The agent anchors one of its own decisions in its ERC-8004 identity: setMetadata(agentId,
 * "decision:<id>", json) from the agent's wallet (only the owner can write its metadata).
 * The value carries the record hash, so anyone can check the off-chain record against it.
 */
export async function anchorDecision(agentPk: Hex, agentId: string, key: string, value: Record<string, unknown>) {
  const hash = await walletFor(agentPk).writeContract({
    address: FUJI.identity,
    abi: IDENTITY_ABI,
    functionName: "setMetadata",
    args: [BigInt(agentId), key, toHex(JSON.stringify(value))],
    gas: 600_000n,
  });
  await confirm(hash);
  return hash;
}

/** Operator (as client) records a closed trade on the ERC-8004 Reputation Registry. */
export async function giveFeedback(agentId: string, pnlPct: number, instId: string, detail: Record<string, unknown>) {
  const uri = `data:application/json;base64,${Buffer.from(JSON.stringify(detail)).toString("base64")}`;
  const hash = await operatorWallet().writeContract({
    address: FUJI.reputation,
    abi: REPUTATION_ABI,
    functionName: "giveFeedback",
    // value = PnL % with 2 decimals, e.g. 1.25% -> 125
    args: [BigInt(agentId), BigInt(Math.round(pnlPct * 100)), 2, "trade", instId, "aviax/spot", uri, keccak256(toHex(JSON.stringify(detail)))],
    gas: 1_500_000n,
  });
  await confirm(hash);
  return hash;
}

export const encodeBytes32 = (h: Hex) => encodeAbiParameters([{ type: "bytes32" }], [h]);
