import { NextRequest } from "next/server";
import { runAgent } from "@/lib/agent";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Streams agent events as newline-delimited JSON. */
export async function POST(req: NextRequest) {
  const { execute = false, universe = 6 } = await req.json().catch(() => ({}));
  const enc = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      try {
        for await (const ev of runAgent({ execute, universe })) controller.enqueue(enc.encode(JSON.stringify(ev) + "\n"));
      } catch (e) {
        controller.enqueue(enc.encode(JSON.stringify({ type: "log", tone: "err", text: (e as Error).message }) + "\n"));
        controller.enqueue(enc.encode(JSON.stringify({ type: "done", ms: 0, verdict: "error" }) + "\n"));
      }
      controller.close();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "application/x-ndjson", "Cache-Control": "no-store" } });
}
