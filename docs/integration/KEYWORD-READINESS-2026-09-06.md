# Keyword operator preflight — Batch 39

Read-only production evidence, 6 September NZ / 5 September UTC. This advances the operator handoff; it does not dispatch a routine or close the full B01–B24 goal.

## Repeatable command

```sh
FLY_BIN=/Users/tomhall-taylor/.fly/bin/flyctl node scripts/verify-keyword-pilot-readiness.mjs
```

No arguments, no `.env` export/pull, no copied API keys, no webhook request. Uses the existing Fly worker's configuration and compiled pilot pin. Checks the canonical app/worker health and source identity, reader configuration/expiry, published n8n revision and header-credential binding, webhook bot filter, saved AVGAR generation/domain and pause. Verifies the single machine/image/release did not change during the check. Failed transport/database reads never become empty/healthy state; errors suppress raw provider/SSH text.

A configuration PASS explicitly retains `receiverAuthenticationProven:false` and `endToEndProven:false`. The script has no run, permit, enable, unpause, republish or retry option. `runKeywordShadowPilot` remains the separately authorized operator execution entry after actual auth/revision acceptance.

## Actual worker receipt

`2026-09-05T14:20:24.958Z`, worker release 22 / SHA `3408671a5569dc94ce6eac2e54bea52d5162e6a3`:

- Account `aa5cfc84-2569-4c99-9b40-67003ae55eda`, generation 1, correct saved AVGAR domain.
- All external action flags off. App/worker release identity and database/worker health pass.
- Expected and observed published revision: `1bce8c54-637e-4770-af90-2da36f38369a`.
- Exact blockers: `execution_reader_disabled`, `webhook_blocks_server_user_agents`, `account_paused_or_missing` (in this receipt the account exists and is paused).
- Zero provider calls, zero permits issued. n8n correction requested in the previous batch; no reply at this turn's one conversation check. Not a claim that Nguyen is the only remaining owner of work: Codex still owns reader activation, compatible repinning/admission and full customer acceptance.

### Secret-free definition comparison for the next handoff

The preflight hashes canonical JSON containing only the workflow's nodes, connections, settings and pinData. It exports hashes, not their contents. Root revision/time/name metadata is excluded. Credentials remain references, never extracted secrets.

- Exact definition hash: `a603b84ce567cfe9804b98e2b25cdd38c784c883ca5560831cf1be1944672c51`.
- Same definition with ONLY the identified webhook's `ignoreBots` normalized to false: `85c5010892e9d6c8d467a69e480ef57307192b23ddf6250f9c0f4561867f58b5`.
- Algorithm: SHA256 over recursively sorted object keys, preserving array order, `sha256-canonical-json-v1`.

The second hash should remain equal if Nguyen changes only that option. Any other definition difference requires inspection, not automatic acceptance. Equal normalized hashes prove that definition comparison only, not provider behavior or credential plaintext equality.

**Repinning requires a coordinated database change too:** the current explicit revision is in `src/worker/issueKeywordShadowPilot.ts` and the service-only SQL bodies created by `20260905083033_keyword_shadow_pilot_issuance.sql` and `20260905092340_keyword_shadow_prepared_start.sql`. Do not edit applied historical migrations or change just an environment variable. After receiving the actual revision, add a reviewed forward migration for the affected function definitions, rerun rollback canaries, release matching app/worker and update the historical-access verifier intentionally. No new revision or migration was invented in this batch.

## Verification and limits

17 Node tests PASS, syntax check and focused ESLint PASS. Tests exercise wrong revision/draft/credential/build/domain/generation, disabled reader, expiry, flags, root reuse, secret projection, failed reads, allowed GET transport and normalized definition hashing. A first structural assertion wrongly classified crypto `.update()` as database mutation; it was replaced by an executed remote-wrapper test whose fake database rejects unexpected operations and whose transport asserts GET/no redirects. The full unchanged app test/build evidence remains Batch 37/38; no unnecessary app rebuild or production mutation in this batch.

Next: Nguyen's corrected validated revision → independent definition diff + explicit repin → successful receiver refusal/auth checks → operator-issued, single-call US/NZ/AU runs → original execution/artifact/receipt and customer reload acceptance. Keep other lane mapping, data/auth and all-client work in the original register; this preflight is not a substitute for those deliverables.
