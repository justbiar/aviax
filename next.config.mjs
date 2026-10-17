/** @type {import('next').NextConfig} */
const nextConfig = {
  // Production build can go to its own folder so it does not disturb a running dev server.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@okx_ai/okx-trade-mcp", "@modelcontextprotocol/sdk"],
  // Allow the dev server to be opened through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
};
export default nextConfig;
