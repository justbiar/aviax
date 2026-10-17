/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@okx_ai/okx-trade-mcp", "@modelcontextprotocol/sdk"],
  // Allow the dev server to be opened through a Cloudflare quick tunnel.
  allowedDevOrigins: ["*.trycloudflare.com"],
};
export default nextConfig;
