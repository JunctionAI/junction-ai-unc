# Account readiness release — 5 September 2026

Status: **PASS for this bounded readiness/release batch; PARTIAL for the full backend goal.** No n8n round trip, ongoing sync, phone delivery or outward action is claimed.

## Deploy result

| Field | Verified result |
|---|---|
| URL | https://junction-unc.vercel.app/app |
| Candidate | https://junction-69tfggvoi-tom-junctionmedis-projects.vercel.app |
| Target | Production, existing `junction-unc` project |
| Status | READY, promoted, canonical health independently read back |
| Deployment | `dpl_Ccr4mnbwiaoT5Ma7391f94eLyXxj` |
| Source | `b7c347bfd9ff862f00b01e6fb71740e26d783b0c` |
| Framework | Next.js 16.3.4 |
| Build duration | 39.532 seconds (`buildingAt` → `ready`) |
| Worker | Existing single Fly machine `1857466fd76998`, Sydney |
| Exact image | `registry.fly.io/unc-worker@sha256:44231bcff9ea4f5d32e72353ddd71b509ece8e48f6f6dacf5d815203b3e9821f` |
| Worker source | Health reports the identical full source SHA; dry-run, no routine runs started |

The app used production configuration with `--skip-domain`, passed candidate checks, then was promoted. No production credentials were copied to preview. The only explicitly supplied build/runtime value was the source SHA. Fly used an exact image digest and `--ha=false --update-only`; the existing single machine was retained and its health check passed. Unlike the preceding batch, both deployment commands completed successfully without reconciliation of an ambiguous failure.

The first readiness release was source `2bb2c579926e23cfc93a46794f176fc67c10a8c8`, deployment `dpl_4YWxr2Q9JkTQ8qZWkFYHZkZqErEj`, build 52.161 seconds. Its UI check caught an additional default-strategy ownership label, corrected by the final source above. Neither release changed schema, credentials, account settings, n8n workflows or action permissions. The progress/evidence documentation commit may follow the runtime source; it does not require another runtime release.

## Behavior fixed

- Home and Strategy display **only persisted plan phases**. An empty plan no longer becomes a generated Content/Email/Paid sequence. Agreement is separate from execution, and elapsed time cannot label work complete.
- Setup counts only connected rows with an explicit selected asset and successful, dated, nonfuture read. Meta and Shopify qualify for AVGAR. This is past read evidence, **not** a freshness SLA, automatic feed or ongoing credential guarantee. Status-only social connections do not qualify.
- Paused accounts see explicit pause copy; plan agreement prompts, routine activation and brief generation are suppressed/disabled. The Home routine switch changes locally only after a successful server enable result.
- Unknown budget/hours stay NULL in account facts. No budget-derived recommendation is substituted for an unknown budget.
- Unagreed strategies are presented as options, not a current/owned play. Saved first-phase suggestions no longer come from a conflicting locally inferred phase.

## Live acceptance

- Candidate `/api/health`: **200**, database healthy, source `b7c347bfd9ff`.
- Unauthenticated `/api/account/state`: **401**. POST `/api/webhooks/apple`: **503 apple_channel_not_ready**. No message was delivered.
- Canonical health at `2026-09-05T04:05:39.784Z`: matching source, healthy database and fresh worker heartbeat.
- Final owner browser: AVGAR Sport, zero enabled routines, explicit automation pause, **2 verified connections — Meta Ads and Shopify**, no invented plan phases, brief button disabled. No “nightly”, “within the hour” or “tomorrow morning” promise in these Home readiness states.
- Strategy: `no saved plan yet`, three `Strategy option` cards, no `CURRENT PLAY`/`YOURS` ownership marker, and an honest empty build-out explanation. No option was selected or plan agreed during acceptance.
- Existing two-message AVGAR chat remains visible after reload. No new model prompt was sent in this batch; the old reply is not a new product-price/CPA verification.
- SQL readback at **04:06:03.528841 UTC**: generation **1**, pause **true**, revision **14**, two chats, zero runs/commands/briefs/enabled routines, empty unagreed plan, NULL budget/hours/margin. Navigation and reload did not create a plan or save a new account revision.
- Final worker config independently retains `UNC_COMMANDS_ENABLED`, `UNC_MESSAGING_ENABLED`, `LIVE_MODE_ENABLED`, `TNZ_SMS_ENABLED`, `APPLE_MESSAGES_ENABLED` all **false**. One machine, expected image, passing health; ticks advanced 1 → 2 by `04:06:15.830Z` with zero routine runs started. Service ticks are not workflow success evidence.

## Validation and observability

- **181 files / 2,116 tests pass**; application and standalone-worker TypeScript pass; final remote production build passes. Lint: zero errors, 39 existing warnings. `git diff --check` passes.
- New regressions cover unbound/undated/future/failed connector evidence, pause controls, exact-account loader reads, NULL versus zero, persisted phases/legacy status, stored-routine suggestions and unagreed strategy labels.
- Bounded error/fatal scans of the final deployment from **04:04 UTC through approximately 04:06 UTC** returned zero entries. This is not continuous alerting proof.
- Vercel drain readback: **zero drains**. No logs were sent to a new vendor; alert delivery, long-term retention and incident monitoring remain incomplete.

## Still open

The full B01–B24 goal remains active. Keep AVGAR paused until captured-generation runtime fencing/admission paths and the keyword pilot acceptance gates are complete. The independent authenticated n8n execution-record reader is still unwired; its test hook does not constitute a production integration. No Nguyen workflow was changed, run, registered or activated. The existing receiver credential by itself does not prove a callable lane.

This batch does not certify every recommendation, benchmark-reference claim, connector freshness policy, toggle combination, route permission, background job, or second-client path. Those keep their acceptance gates in `BACKEND-COMPLETION-PLAN-2026-09-05.md`. Do not undo the protected context/memory schema or restore a pre-enforcement browser writer when diagnosing a display issue; prefer a compatible forward fix.

Next.js/React guidance informed saved-data versus client-derived state and success-only switch updates. Supabase guidance informed account-scoped read-only evidence checks. Vercel deployment/environment guidance informed unaliased preflight, exact source/image readback and post-release observability reporting.
