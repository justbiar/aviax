import { NextRequest, NextResponse } from "next/server";

/**
 * Public demo (Cloudflare tunnel): visitors can build agents and run them, but the
 * operator's own funds stay local-only. Public requests are tagged with
 * x-aviax-public; wallet changes are blocked outright. Bots, crawlers and scripted
 * clients are turned away on the public link (no rate limits: only the jury has it).
 */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ONLY = [/^\/api\/wallet/, /^\/api\/signal\/[^/]+\/agentic/];
const BOT = /bot|crawl|spider|slurp|scrap|curl|wget|python|httpx|aiohttp|go-http|java\/|okhttp|axios|node-fetch|undici|libwww|postman|insomnia|headless|phantom|selenium|puppeteer|playwright|facebookexternalhit|embedly|preview|monitor|uptime/i;
// Paid agent endpoints (x402) are meant for programmatic callers.
const AGENT_OK = [/^\/api\/company\/decision\//];

export function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isPublic = !LOCAL.test(host) || req.headers.has("cf-connecting-ip");
  const headers = new Headers(req.headers);
  headers.delete("x-aviax-public");
  if (isPublic) {
    const ua = req.headers.get("user-agent") ?? "";
    if ((!ua || BOT.test(ua)) && !AGENT_OK.some((r) => r.test(req.nextUrl.pathname))) {
      return new NextResponse("Forbidden", { status: 403, headers: { "X-Robots-Tag": "noindex, nofollow" } });
    }
    if (req.method !== "GET" && req.method !== "HEAD" && LOCAL_ONLY.some((r) => r.test(req.nextUrl.pathname))) {
      return NextResponse.json({ error: "Cüzdan işlemleri sadece sunum makinesinden yapılır." }, { status: 403 });
    }
    headers.set("x-aviax-public", "1");
  }
  const res = NextResponse.next({ request: { headers } });
  if (isPublic) res.headers.set("X-Robots-Tag", "noindex, nofollow");
  return res;
}

// Pages and APIs; static assets skip the middleware.
export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
