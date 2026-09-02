#!/bin/bash
# Dev server with Junction env loaded (ANTHROPIC_API_KEY etc.).
# Secrets stay in the Junction Drive root .env — never copied into this repo.
# Sources the root .env directly (the shared loader can hang when Drive is cold).
JUNCTION_ROOT="${JUNCTION_ROOT:-/Users/tomhall-taylor/Library/CloudStorage/GoogleDrive-halltaylor.tom@gmail.com/My Drive/Junction AI — Autonomous Marketing}"
if [ -z "$ANTHROPIC_API_KEY" ] && [ -f "$JUNCTION_ROOT/.env" ]; then
  set -a; # shellcheck disable=SC1091
  source "$JUNCTION_ROOT/.env" >/dev/null 2>&1; set +a
fi
if [ -n "$ANTHROPIC_API_KEY" ]; then echo "[dev.sh] ANTHROPIC_API_KEY: present"; else echo "[dev.sh] ANTHROPIC_API_KEY: MISSING (chat will use canned fallback)"; fi
cd "$(dirname "$0")/.." && exec npx next dev --port "${PORT:-3400}"
