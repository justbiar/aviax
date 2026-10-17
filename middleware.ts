import { NextRequest, NextResponse } from "next/server";

/**
 * Public demo (Cloudflare tunnel): visitors can build agents and run them, but the
 * operator's own funds stay local-only. Public requests are tagged with
 * x-aviax-public so routes can apply limits; wallet changes are blocked outright.
 */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;
const LOCAL_ONLY = [/^\/api\/wallet/, /^\/api\/signal\/[^/]+\/agentic/];

export function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isPublic = !LOCAL.test(host) || req.headers.has("cf-connecting-ip");
  const headers = new Headers(req.headers);
  headers.delete("x-aviax-public");
  if (isPublic) {
    if (req.method !== "GET" && req.method !== "HEAD" && LOCAL_ONLY.some((r) => r.test(req.nextUrl.pathname))) {
      return NextResponse.json({ error: "Cüzdan işlemleri sadece sunum makinesinden yapılır." }, { status: 403 });
    }
    headers.set("x-aviax-public", "1");
  }
  return NextResponse.next({ request: { headers } });
}

export const config = { matcher: "/api/:path*" };
