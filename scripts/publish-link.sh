#!/usr/bin/env bash
# Points https://aviax.pages.dev at the current Cloudflare quick tunnel.
# Usage: scripts/publish-link.sh https://<name>.trycloudflare.com
set -euo pipefail
TUNNEL="${1:?tunnel URL, e.g. https://xyz.trycloudflare.com}"
DIR="$(cd "$(dirname "$0")/../deploy/pages-proxy" && pwd)"
sed "s#__TUNNEL__#${TUNNEL%/}#" "$DIR/_worker.template.js" > "$DIR/public/_worker.js"
npx --yes wrangler@3 pages deploy "$DIR/public" --project-name aviax --branch main --commit-dirty=true
