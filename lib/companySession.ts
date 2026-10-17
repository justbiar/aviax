import { randomBytes } from "node:crypto";
import type { ModelSpec } from "./decide";
import type { Address } from "viem";

export type OkxCredentials = { apiKey: string; secretKey: string; passphrase: string };
export type CompanyRiskPolicy = { maxWeight: number; maxDrawdown: number; minReserve: number; maxVol: number; approvalUsd: number };
export type CompanySession = {
  companyName: string;
  okx: OkxCredentials;
  model: "ours" | "local" | "openrouter";
  modelSpec?: ModelSpec;
  secondModelSpec?: ModelSpec;
  openrouterKey?: string;
  queryPriceUsdc: number;
  payoutAddress: Address;
  riskPolicy?: CompanyRiskPolicy;
  companyAgentId?: string;
  /** Shared jury demo: built server-side from the host .env, read-only, keys never leave the server. */
  demo?: boolean;
  publicId: string;
  expiresAt: number;
};

const sessions = globalThis as typeof globalThis & { __aviaxCompanySessions?: Map<string, CompanySession> };
sessions.__aviaxCompanySessions ??= new Map();
const COOKIE = "aviax_company";

export function getCompanySessionId(cookieHeader: string | null) {
  const match = cookieHeader?.match(new RegExp(`(?:^|;\\s*)${COOKIE}=([a-f0-9]{48})(?:;|$)`));
  return match?.[1];
}

export function getCompanySession(id?: string) {
  if (!id) return undefined;
  const value = sessions.__aviaxCompanySessions!.get(id);
  if (value && value.expiresAt <= Date.now()) { sessions.__aviaxCompanySessions!.delete(id); return undefined; }
  return value;
}

export function saveCompanySession(value: Omit<CompanySession, "publicId" | "expiresAt">) {
  const id = randomBytes(24).toString("hex");
  for (const [key, active] of sessions.__aviaxCompanySessions!) if (active.expiresAt <= Date.now()) sessions.__aviaxCompanySessions!.delete(key);
  const session: CompanySession = { ...value, publicId: randomBytes(18).toString("hex"), expiresAt: Date.now() + 86_400_000 };
  sessions.__aviaxCompanySessions!.set(id, session);
  return { id, session, cookie: `${COOKIE}=${id}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400${process.env.NODE_ENV === "production" ? "; Secure" : ""}` };
}

export function getCompanySessionByPublicId(publicId: string) {
  for (const [key, value] of sessions.__aviaxCompanySessions!) {
    if (value.expiresAt <= Date.now()) sessions.__aviaxCompanySessions!.delete(key);
    else if (value.publicId === publicId) return value;
  }
  return undefined;
}

export function clearCompanySession(id?: string) {
  if (id) sessions.__aviaxCompanySessions!.delete(id);
}

export function updateCompanySession(id: string | undefined, patch: Partial<Pick<CompanySession, "model" | "modelSpec" | "secondModelSpec" | "openrouterKey" | "riskPolicy" | "companyAgentId">>) {
  const session = getCompanySession(id);
  if (!session) return undefined;
  Object.assign(session, patch);
  return session;
}

/** History key: the shared jury demo, a connected company, or the localhost owner. */
export const historyKey = (session?: CompanySession) => (session ? (session.demo ? "demo" : `company:${session.publicId}`) : "owner");
