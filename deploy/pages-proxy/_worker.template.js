// aviax.pages.dev: short public address for the Aviax demo running on the presenter's machine.
// Every request is passed to the Cloudflare tunnel unchanged (method, headers, body, cookies, streaming).
const ORIGIN = "__TUNNEL__";

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = ORIGIN + url.pathname + url.search;
    const init = { method: request.method, headers: request.headers, redirect: "manual" };
    if (request.method !== "GET" && request.method !== "HEAD") init.body = request.body;
    const res = await fetch(target, init);
    const headers = new Headers(res.headers);
    const loc = headers.get("location");
    if (loc && loc.startsWith(ORIGIN)) headers.set("location", loc.slice(ORIGIN.length) || "/");
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  },
};
