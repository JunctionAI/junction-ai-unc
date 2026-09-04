# Unc

Unc is Junction AI's private-beta growth operating partner for founder-led businesses. It learns
the business, works against an agreed goal, and runs 35 inspectable routines across content, paid
ads, SEO, sales, and email/SMS. The product is designed around one rule: Unc can prepare useful
work autonomously, but a consequential outward action stays visible, bounded, approved, and
receipted.

This repository contains the Next.js app, Supabase schema, routine runtime, always-on worker,
model router, connector readers, n8n skill bridge, and browser/unit test harness. It is a
private-beta codebase, not proof of a connected customer deployment. Customer-facing sends,
publishing, ad spend, pricing changes, and destination mutations are disabled in the shipped
worker. Founder-directed channel notifications are a separate, explicitly linked delivery lane.

## What is implemented

- 35 catalog routines and 35 built-in skill contracts. Each eligible run produces an artifact or
  an honest `waiting_input` request before it reaches a gate.
- Ten launch-wave routines are draft-only. Another twelve wave-2 routines produce research,
  planning, or supervised drafts. Thirteen routines prepare mutation proposals behind gates.
- Account-scoped artifacts, approvals, receipts, memories, model preferences, presets, and routine
  state, with Supabase row-level-security migrations.
- An interchangeable model router for Anthropic, OpenAI, Gemini, OpenRouter, and an
  OpenAI-compatible custom endpoint. Model choice can vary by task and account.
- A signed n8n seam for every routine. An account or global workflow can supply the same artifact
  contract as the built-in skill without receiving the customer's platform credential.
- Typed Meta action previews with guards, spend caps, risk gates, idempotency, rollback metadata,
  and provider readback contracts. Live execution remains off.

See [docs/ROUTINES-REAL-WORK.md](docs/ROUTINES-REAL-WORK.md) for the runtime contract and
[docs/OVERNIGHT-READINESS.md](docs/OVERNIGHT-READINESS.md) for the current private-beta boundary.

## Run locally

Requirements: Node.js 22, npm, and no credentials for demo mode.

```bash
npm ci
npm run dev
```

Open <http://localhost:3000>. Demo mode uses local fixture state and is visibly labelled; it is not
customer execution proof.

For the browser acceptance harness, run the app on the port expected by Playwright:

```bash
PORT=3400 npm run dev
# in another shell
npm run e2e
```

`scripts/dev.sh` is a convenience for Tom's local Junction environment. It may source a provider
key from the configured Junction root, but it never copies that key into this repository.

## Verification commands

```bash
npm run lint
npx tsc --noEmit
npx tsc -p tsconfig.worker.json --noEmit
npm test
npm run build
npm run e2e
```

Run these against the exact commit being reviewed. A green local or CI build still does not prove
that a provider, connector, n8n workflow, Supabase migration, worker deployment, or outward action
has run against AVGAR or another customer; those need separate fresh receipts.

## Configure a real account

The system is independently env-gated. Start with the database and authentication instructions in
[docs/FIRST-BOOT.md](docs/FIRST-BOOT.md), then follow [docs/RUNBOOK.md](docs/RUNBOOK.md). The main
secret groups are:

- Supabase public URL/key plus a server-only service-role key.
- At least one model provider, with optional per-task and per-account selection; see
  [docs/MODELS.md](docs/MODELS.md).
- A connector encryption key and client-owned OAuth/app credentials; see
  [docs/CONNECTORS-FIRST-BOOT.md](docs/CONNECTORS-FIRST-BOOT.md).
- An n8n signing secret when external workflows are used; see
  [docs/N8N-ROUTINES.md](docs/N8N-ROUTINES.md).

Never commit secrets. A configured credential or workflow row is not a successful read, draft,
approval, mutation, or delivery receipt.

## Safety boundary

- The worker accepts dry runs; `LIVE_MODE_ENABLED` is `false` in `src/worker/service.ts`.
- A mutation path is structurally ordered `produce -> gate -> execute -> receipt`.
- Unknown action verbs fail closed. Today the typed action registry is Meta-only, and campaign
  creation remains dry-run-only even inside that registry.
- Founder artifact approval and run-level mutation approval are distinct. Approving copy does not
  silently authorize publishing, sending, spending, or changing a destination system.
- Real accounts are invite-only. Server-side owner checks govern plan agreement, model/routine
  settings, connector and channel changes, artifact taste decisions, and mutation approvals.
- Account model calls fail closed unless a service-role, account-locked spend reservation fits the
  monthly cap. The reservation is released only after the usage ledger is durable.
- Reads, artifacts, approvals, and receipts are account scoped. The forward migrations remove
  public/authenticated execution of privileged RPCs and governed writes; they must still be applied
  and verified under real anon, authenticated, and service roles on each target Supabase project.

No deployment, migration, credential change, send, publish, or spend is implied by cloning or
running this repository.
