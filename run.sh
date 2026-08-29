#!/usr/bin/env bash
# Start the built inventory server (API + web UI on one port).
# Usage:  ./run.sh          (production, reads ./.env)
#         ./run.sh --build   build everything first, then start
set -euo pipefail
cd "$(dirname "$0")"

if [[ "${1:-}" == "--build" ]]; then
  npm ci
  npm run build
fi

if [[ ! -f packages/server/dist/index.js ]]; then
  echo "Not built yet. Run:  npm run build   (or ./run.sh --build)" >&2
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "No .env found. Copy .env.example to .env and edit it first." >&2
  exit 1
fi

# WEB_DIST_DIR defaults to this checkout's build if not set in .env
export WEB_DIST_DIR="${WEB_DIST_DIR:-$(pwd)/packages/web/dist}"

exec node --env-file=.env packages/server/dist/index.js
