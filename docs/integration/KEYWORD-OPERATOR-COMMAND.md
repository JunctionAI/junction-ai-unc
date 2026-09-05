# Keyword pilot operator command

This closes the command-line entry gap, not provider or customer acceptance. Credentials stay on the existing Fly worker. No app/worker deployment is required for this script; it calls the already-deployed pilot module. The actual reviewed revision and both SQL function pins still need updating after Nguyen's bot-filter correction.

## Read-only lookup

`FLY_BIN=/Users/tomhall-taylor/.fly/bin/flyctl node scripts/keyword-pilot.mjs --inspect --approval /absolute/path/original-approval.json`

Uses the original account/generation/key and checks the stored complete approval before returning IDs/status. Expired approvals are inspectable. A database error is not absence. Neither absence nor an existing reserved permit authorizes redispatch. No recovery or completion is performed by this command.

Real release-22 worker smoke check on 6 September NZ used `scripts/tests/fixtures/keyword-pilot-inspect-only.json` (expired in 2000; explicitly no run authority). Result: `NOT_FOUND`, `safeToRedispatch:false`. The command verified the single existing machine and unchanged image/release across the read. No permit, workflow or provider call was made. This proves the real command/read path only, not the mutating issuance path.

## Explicit one-market issuance

`FLY_BIN=/Users/tomhall-taylor/.fly/bin/flyctl node scripts/keyword-pilot.mjs --issue --approval /absolute/path/original-approval.json --expected-build REVIEWED_40_CHARACTER_SHA --expected-revision REVIEWED_PUBLISHED_REVISION_UUID`

The approval file has exactly: `authorizedBy`, `approvalReference`, `idempotencyKey`, `market`, `contextGeneration`, `maxProviderCalls`, `expiresAt`. The existing reviewed pilot fixes owner/account/generation; market is one of US/NZ/AU, max calls is 1, expiry must be within ten minutes. The reference must cite actual owner authority; the CLI does not create approval or invent a key/expiry. Never put API keys or bearer tokens in this file.

Before invocation: review Nguyen's changed definition, repin the two applied SQL function bodies through a forward migration and the worker source, release coherently, prove receiver authorization/refusal behavior and execution-read access, then clear the explicit pilot setup holds. The command itself never changes flags, pause, switches, credentials, schedules or workflow definitions.

It checks the exact deployed build/revision and the live read-only preflight, then invokes the existing owner-checked, atomic single-market pilot function once. A previously issued key returns its original identities without calling it again. SQL remains the concurrency guard. A transport error is uncertain: inspect the **same original file/key**, then use existing explicit recovery/reconciliation tools as appropriate; do not mint a replacement. A verified permit is not by itself proof that the customer artifact and receipt appeared correctly.

## Verification

19 command tests plus 17 existing readiness tests and 50 existing pilot-issuance regression tests pass. Coverage includes all three market parsers, wrong owner/generation/extra fields, exact pins, expired inspection, expired issuance refusal, database errors, one invocation, duplicate-key refusal, uncertain replies, sanitized output and serialization on the worker. ESLint and diff checks pass. No production issue operation has been run. Nguyen's correction remained unanswered at this turn's one fresh Upwork read; no duplicate message was sent.
