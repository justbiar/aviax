import { NextRequest, NextResponse } from "next/server";

/**
 * Public demo (Cloudflare tunnel) is read-only: anything that changes state
 * (creating agents, orders, wallets, agent runs) only works from localhost.
 */
const LOCAL = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/;

export function middleware(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host") ?? "";
  const isPublic = !LOCAL.test(host) || req.headers.has("cf-connecting-ip");
  if (isPublic && req.method !== "GET" && req.method !== "HEAD") {
    return NextResponse.json({ error: "Herkese açık demo salt okunur. Ajan oluşturma ve emirler sadece sunum makinesinden yapılır." }, { status: 403 });
  }
  return NextResponse.next();
}

export const config = { matcher: "/api/:path*" };
