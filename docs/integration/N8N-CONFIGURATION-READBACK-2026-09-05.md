# n8n integration configuration: live readback, not pilot acceptance

5 September 2026, approximately 06:34 UTC. This supersedes earlier missing-worker-signing observations, not the full backend completion register.

## Completed

- Independently verified the existing production signing root without revealing it: a correctly signed, empty-scope token for a random nonexistent account/run returned **404 / no stored run** from `/api/n8n/shadow-authority`; an altered signature returned **401 / mismatch**. Neither token authorizes real work. No workflow/provider request was made.
- Provisioned that same existing root to **Fly `unc-worker`** through stdin. No key rotation, provider credential export, n8n credential change or secret file was used. A one-time HMAC challenge from the existing machine matched the production-tested root; only the match result was printed.
- Added these exact settings to the worker and Vercel **Production**:
  - `N8N_DATA_BASE_URL=https://junction-unc.vercel.app`
  - `N8N_SHADOW_RECEIVER_URL=https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow`
- The worker is release **14**, still machine `1857466fd76998`, with unchanged image `registry.fly.io/unc-worker@sha256:694e435341a950bb3173004d07fa214f5fc9851107c6228290f56cddc8860e5c`.
- Initial Vercel configuration redeploy `dpl_7Rn6dP6rJnvosuQyXrpNR6SeHNC3` retained source but dropped the per-deployment `VERCEL_GIT_COMMIT_SHA` override. Post-deploy health exposed this as `sha:null`; metadata alone was not accepted as a passing app/worker health check.
- Corrective candidate **`dpl_4zqqARcoMhiUZCagcLusCJvM6cHZ`** was built from a clean detached checkout of exact source **`00fc57cfd07b175bc0d0c452c94f32ecd2d1e735`**, with that verified SHA set for this deployment's build/runtime only. No persistent, potentially stale project-wide SHA variable was added. Candidate was **READY**, approximately **43.9 seconds** build time, with production environment and automatic promotion withheld until smoke checks passed. Pre-promotion health reported the correct SHA, healthy DB/fresh worker; account-state returned 401 and reserved Apple returned 503.
- Promoted the corrected candidate, then independently checked the canonical origin at **06:34:35 UTC**: matching app/worker SHA, healthy database/fresh worker, root-signing match and preserved disabled flags. The transient missing fingerprint is corrected, not waived.
- Neither app build included the dirty checkout or the unreleased channel changes. Original rollback reference remains `dpl_CJ3wGqojJj3eaWmktmQTCs6rsYy2` (without the new URL configuration).
- Five worker action flags remain explicitly false; execution reader remains disabled. No registration, routine enablement, database migration, model call or provider call was performed.

Repeatable operator check: `scripts/provision-n8n-worker-signing.mjs`. Default mode is read-only; `--apply` fills only missing values and refuses different existing roots/URLs, unexpected machine topology, enabled action flags and missing/mismatched app/worker build fingerprints. The helper verifies signing and configuration only; it explicitly does **not** certify shadow dispatch readiness.

The script uses [Vercel environment injection](https://vercel.com/docs/cli/env) and [Fly encrypted secrets via stdin](https://fly.io/docs/apps/secrets/). Vercel cannot pull sensitive variables; the receiver key was neither pulled nor copied from another environment. No secret values or issued tokens appear in this document, logs or commits.

## New credential evidence

The deployed worker's `N8N_SHADOW_RECEIVER_TOKEN` is present but **21 characters**. The current bridge requires at least 24 characters, no whitespace, and a credential different from the signing root. It therefore refuses this value before any webhook POST.

This is an actual worker environment check, not just a secret-name listing. The value was not printed. Its equality with n8n's Header Auth and Vercel's sensitive receiver variable is **unverified**. Do not infer those are wrong too, rotate them blindly or relax the minimum to make the check pass.

Repair order:

1. Confirm the intended existing receiver credential's format through the authorized credential owner, without transmitting its value in chat.
2. If n8n/Vercel already share a valid value, securely provision that same value to Fly only. Otherwise coordinate a replacement across the existing n8n Header Auth, Vercel Production and Fly. Never use the root signing key as the receiver bearer.
3. Recheck environment validity and authentication with a bounded denial test before an authorized provider run. Account pause/reader/admission gates stay closed throughout.

The owner-run `scripts/stage-n8n-receiver-secret.command` accepts a minimum-24-character, no-whitespace value privately and stages it without deploying. A staged name or length check alone is not proof the receiver accepts it.

## Supported execution API access

Fresh authenticated browser inspection: n8n Cloud still shows **9 days left** on the trial, and Settings has no **n8n API** item. The visible app version link is `2.38.3`. No workflow or credential was opened/edited/executed in this check.

[Official n8n documentation](https://github.com/n8n-io/n8n-docs/blob/main/docs/connect/n8n-api/authentication.md) says public API access is unavailable during the trial. It also says non-Enterprise keys have full account resource/capability access; Enterprise can restrict scopes, including `execution:read`. A GET-only Unc reader limits this application's behavior but does **not** turn an underlying broad key into a provider-enforced read-only key.

The actual account's change-plan screen offers **Starter €24/month**, billed monthly, 2,500 executions / five concurrent executions / one shared project; **Pro €60/month**, billed monthly. Prices exclude applicable taxes. Only the plans screen was opened. No plan was selected, checkout completed, API key created or browser-session authentication reused as an API workaround.

Tom must authorize the commercial plan and non-Enterprise key risk, or choose a supported scoped alternative. Codex owns secure server-side provisioning and actual saved-execution shape/readback tests once access exists. Do not ask Nguyen to add version-discovery calls inside the wrapper.

## Remaining integration gates

1. Nguyen's final **origin-configured** published revision and webhook-node confirmation. The workflow list now says the wrapper was updated recently; that is not revision/configuration proof. Do not reuse the old revision as though its placeholder was fixed. No new executing-version field is required.
2. Valid matching receiver credential and supported independent execution-reader access/configuration/live proof.
3. Codex-owned account/run/spec/revision registration, captured-context coverage, bounded provider-call admission and durable duplicate/uncertain-call reconciliation. The current read-only authority preflight is **not** a one-use paid-provider permit.
4. Then the authorized `golf travel bag` test separately for US/NZ/AU, with saved execution plus correlated Unc artifact/receipt readback. No publishing, customer messaging or ad mutation/spend activation.

## Verification and boundaries

- **81 focused tests across three files passed**: shadow contract, independent execution reader and data tokens. Added explicit 21-/23-character and whitespace receiver-denial regressions. These are synthetic tests, not live provider execution proof.
- Operator helper syntax check, focused ESLint and `git diff --check` passed; live operator readback passed for signing, canonical worker URLs, unchanged image and disabled action flags.
- SQL at **06:27:26 UTC**: AVGAR generation **1**, revision **15**, automation paused; enabled routines **0**, runs **0**, total n8n registrations **0**.
- Post-restart production health at **06:27:22 UTC**: app source `00fc57cfd07b`, healthy DB, fresh worker with two ticks/no error. Later post-deploy checks are recorded in the progress ledger.
- Bounded Vercel error/fatal scan, **06:27:00–06:29:10 UTC**, returned no entries. This is not ongoing monitoring or verified alert delivery; log drains/alerting remain a separate unfinished gate.
- Corrected-deployment error/fatal scan **06:32:00–06:34:42 UTC** also returned no entries. Fresh authenticated drain inventory returned **0**. Monitoring/alert delivery therefore remains an explicit gap despite these clean bounded scans.
- Unfinished chat-generation edits and the two committed-but-unreleased channel migrations remain local/source-only. This configuration redeploy did not include them. Full B01–B24 acceptance remains open.

## Copyable addition for Nguyen

Codex has now provisioned and verified the matching production app/worker signing root and canonical data/receiver URLs. The code revision is unchanged and the pilot is still disabled.

Two access checks remain: the worker's installed receiver value fails the bridge's minimum-24-character format check (its value has not been exposed), and this n8n workspace is still on trial without public API access. Please confirm the intended existing Header Auth credential meets the format requirement without sending the secret. We should reconcile the existing value before deciding whether a coordinated replacement is needed. Codex owns secure app/worker provisioning; Tom owns any plan/credential-scope approval.

Please return your final origin-configured published revision and webhook-node ID. Keep the actual workflow/execution IDs, workflowVersion null and revisionEvidence pending_unc_verification. Do not add a version lookup or start the paid test yet. Codex still owes the durable admission/reconciliation and registration gates before issuing the authorized run context.
