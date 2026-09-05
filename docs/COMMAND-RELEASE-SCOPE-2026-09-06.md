# Customer command release scope — source implementation

Status: implemented and tested locally; not deployed or enabled. B03 remains partial.

The existing command path had a global on/off switch, not a per-client rollout boundary. Its queue consumer checked the routine before starting, but did not recheck the selected routine/owner/implementation during later runtime steps. That cannot safely express “release the accepted routine to this account only”.

## Implemented behavior

- Production command admission now requires both `UNC_COMMANDS_ENABLED=true` and a matching entry in server-only `UNC_COMMAND_RELEASE_SCOPES`. Missing/malformed configuration permits no new commands.
- An entry contains exactly `accountId`, `contextGeneration`, `channel`, `routineId`, `specHash`, `workflowHash`, and `expiresAt`. Account IDs are UUIDs, generation must be an explicit nonnegative integer, hashes are full SHA-256 fingerprints, expiry is canonical ISO UTC. No wildcards, duplicate account/generation/channel/routine entries or unknown fields. Maximum 100 entries / 32 KiB.
- `specHash` is the command queue's digest of the entire effective specification. `workflowHash` includes selected workflow ID, account, **routine ID**, URL and active status, or the digest of null for an explicitly selected built-in producer. This is rollout configuration, not proof of actual execution revision; n8n's independent execution reader remains required.
- Owner/channel binding, account pause/generation, enabled routine, reader availability and model budget remain separate checks. Enabling the global flag alone no longer admits any routine.
- The worker checks the queued fingerprints against supplied execution arguments and saved settings. It captures copies of those arguments and rechecks owner, switch, generation, rollout expiry and saved specification/workflow at every engine context boundary, including persistence boundaries. A request already in flight cannot be recalled. A revoked selection stops subsequent work and acceptance; its original command can remain uncertain for inspection, never automatically replayed.
- Exact slash requests while the global flag is off now return a deterministic “nothing queued or started” response rather than falling into ordinary conversation. Ordinary chat stays available.
- D03-W01 deliberately still refuses generic command admission. The operator pilot's one-call allowance is not customer authority. No keyword admission was bypassed to obtain passing tests.

## Verification

Full unit suite: **211 files / 2,687 tests pass**, including 40 new tests. Both application and standalone-worker TypeScript checks and focused ESLint pass. Provider calls in these new tests use fakes, never real credentials or paid APIs.

The tests exercise the actual app command router, DB command queue adapter, processor and worker engine with fake storage/provider I/O: exact selection → one run → correlated stored artifact; duplicate delivery → original completed request; multiple enabled routines → only the released routine admitted; all-off → refusal; global flag alone → refusal; release withdrawn after queueing → blocked before execution; owner/switch/spec/release changes during a read → no next producer call or accepted artifact; no outward executor calls. They also test wrong tenant/channel/generation, expired/malformed scopes, implementation substitution and keyword-allowance bypass refusal.

## Required next work before customer activation

1. Connect a customer request to the existing **atomic one-use keyword issuance/start protocol**, with captured owner, generation, market/seed, original request ID, selected configuration and expiry. Do not call the operator CLI from chat or infer an allowance from a model answer. US/NZ/AU should remain three distinct provider tasks, not an ambiguous default country.
2. Make the customer keyword switch/configuration reflect that exact registered adapter; replace the generic D03-W01 refusal only when the scoped admission is available. The ordinary catalog producer and fixed operator-only module are not interchangeable implementations.
3. Deploy compatible app/worker code with empty scopes first. An older command carrying the previous workflow fingerprint must be rejected/reconciled, not have its historical fingerprint rewritten. Inspect existing commands before rollout.
4. After the accepted adapter/output revision is pinned, configure only the reviewed account/channel/spec scope. Verify a signed-in customer request, switch-off refusal, duplicate, real stored result and reload. Retain independent saved-execution evidence. No channels or other clients inherit an app-only scope.
5. The scope list is rollout control, not durable provider cost accounting, refresh ownership, universal authorization or all-client acceptance. B05–B24 still require their own evidence.

No production environment, account pause, database, routine switch, workflow, provider call or external-action setting was changed in this batch. No new message was sent to Nguyen; his existing delivery request remains separate from this Codex-owned implementation.
