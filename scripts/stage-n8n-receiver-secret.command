#!/bin/bash
# Owner-run setup. The secret is read privately, piped to Fly, and never written to a file.
set -euo pipefail

unc_flyctl='/Users/tomhall-taylor/.fly/bin/flyctl'
if [[ ! -x "$unc_flyctl" ]]; then
  printf 'Fly CLI is unavailable. Nothing changed.\n'
  exit 1
fi

printf 'Stage the Unc receiver token on Fly app unc-worker. No restart or deployment.\n'
printf 'Paste the SAME secret used in n8n and Vercel, WITHOUT the Bearer prefix.\n'
IFS= read -r -s -p 'Secret (hidden): ' unc_receiver_secret </dev/tty
printf '\n'
trap 'unset unc_receiver_secret' EXIT

if [[ ${#unc_receiver_secret} -lt 24 || "$unc_receiver_secret" =~ [[:space:]] || "$unc_receiver_secret" == 'YOUR_NEW_RANDOM_SECRET' ]]; then
  printf 'Invalid secret format. Nothing changed.\n'
  exit 1
fi

printf 'N8N_SHADOW_RECEIVER_TOKEN=%s\n' "$unc_receiver_secret" |
  "$unc_flyctl" secrets import --app unc-worker --stage
unset unc_receiver_secret
printf '\nToken staged. The worker has NOT been restarted. Return to Codex and say staged.\n'
read -r -p 'Press Enter to close.' </dev/tty
