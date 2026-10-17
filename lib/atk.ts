import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/**
 * OKX Agent Trade Kit (okx-trade-mcp) client.
 * The agent talks to OKX through ATK's MCP tools, the same server Claude/Cursor would use.
 */

type G = typeof globalThis & { __atk?: Promise<Client> };
const g = globalThis as G;

function binPath() {
  return path.join(process.cwd(), "node_modules", "@okx_ai", "okx-trade-mcp", "dist", "index.js");
}

async function connect() {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [binPath(), "--modules", "market,account,swap"],
    env: {
      ...(process.env as Record<string, string>),
      OKX_API_KEY: process.env.OKX_API_KEY ?? "",
      OKX_SECRET_KEY: process.env.OKX_SECRET_KEY ?? "",
      OKX_PASSPHRASE: process.env.OKX_PASSPHRASE ?? "",
      OKX_DEMO: process.env.OKX_DEMO === "0" ? "0" : "1",
      OKX_UPDATE_CHECK: "0",
    },
    stderr: "ignore",
  });
  const client = new Client({ name: "aviax-agent", version: "0.1.0" });
  await client.connect(transport);
  transport.onclose = () => {
    g.__atk = undefined;
  };
  return client;
}

export function atkClient() {
  if (!g.__atk) {
    g.__atk = connect().catch((e) => {
      g.__atk = undefined;
      throw e;
    });
  }
  return g.__atk;
}

export async function atkListTools() {
  const c = await atkClient();
  const { tools } = await c.listTools();
  return tools.map((t) => t.name);
}

/** Calls an ATK tool and returns parsed JSON (or raw text). */
export async function atkCall<T = unknown>(name: string, args: Record<string, unknown> = {}): Promise<T> {
  const c = await atkClient();
  const res = (await c.callTool({ name, arguments: args })) as { content?: { type: string; text?: string }[]; isError?: boolean; structuredContent?: unknown };
  if (res.structuredContent) return res.structuredContent as T;
  const text = res.content?.find((p) => p.type === "text")?.text ?? "";
  if (res.isError) throw new Error(`ATK ${name}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    return text as unknown as T;
  }
}

/** ATK responses look like { tool, ok, data: { endpoint, data: [...] } }. */
export function atkData<T>(r: unknown): T[] {
  let cur: unknown = r;
  for (let i = 0; i < 3; i++) {
    if (Array.isArray(cur)) return cur as T[];
    const next = (cur as { data?: unknown } | null)?.data;
    if (next === undefined) break;
    cur = next;
  }
  return [];
}
