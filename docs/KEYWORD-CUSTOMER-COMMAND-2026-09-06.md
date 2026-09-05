# Customer keyword command — admission installed, app release pending

Status: **database admission deployed and independently read back; application/worker source tested, not yet deployed.** This advances B03; it does not prove a signed-in customer run or complete the backend register.

## Request path

The existing app command router/queue remains the entry. D03-W01 now accepts only an app owner on the registered AVGAR account with an explicitly saved, canonical v2 keyword specification and matching release scope. The saved specification chooses exactly one of US/NZ/AU, with `golf travel bag`, `avgarsport.com`, English and frozen wrapper revision `92135add-3c35-43e4-9649-5bb3d4557814`. No model-generated country, owner, account, URL, credential or permission is accepted.

The worker claims the command once, keeps `runId=commandId`, and derives an immutable one-call allowance with key/reference `keyword-command:<commandId>`. Its expiry is **command creation + ten minutes**, not worker start + ten minutes. Delays and redelivery do not renew it. The SQL compares the claimed app command, owner, enabled saved specification, registration and exact queued fingerprints before delegating to the existing verified issuance/start primitives.

The serialized specification/workflow strings are checked twice in SQL: their parsed JSON must equal the authoritative saved objects and their SHA-256 must equal the immutable queue fingerprints. Hashing is performed with PostgreSQL's built-in SHA-256, not an extension or an echoed hash. [PostgreSQL reference](https://www.postgresql.org/docs/17/functions-binarystring.html).

Existing operator exports/CLI remain compatible. Shared primitives moved to `src/lib/n8n/keywordAdmission.ts`; customer code does not call the operator entry/CLI. Canonical recipe comparison is deep structural equality, so a real JSONB read's object-key ordering cannot falsely reject the same recipe. Tests exercise actual JSONB round-tripping.

The new customer permit trigger additionally rechecks the selected routine at dispatch and at the wrapper's one-use provider-authority callback. Switching off after worker pickup but before authority consumption blocks that provider authorization. Already-issued network traffic cannot be recalled; terminal observations retain the existing archival rules. This is not a general promise to undo work already sent.

The Agents API no longer reports a permanent operator-only block: it exposes the switch only when the saved canonical keyword adapter and exact account/market release exist. Missing/unreadable configuration still refuses. Checking/changing a switch does not itself issue an allowance or start a provider call.

## Database release and readback

- Source migration: `20260905151627_keyword_command_admission.sql`; applied production migration **20260905152646**, name `keyword_command_admission`, project `ycgayfsvcjpsnryrpukv`.
- Three new RPCs: `assert_keyword_command_binding`, `issue_keyword_shadow_command`, `claim_keyword_shadow_command_start`. All are security-invoker, empty search path, execute granted to service_role only. No anon/authenticated execute grant. The private trigger function has no direct service-role execute grant. [Supabase function privilege guidance](https://supabase.com/docs/guides/database/functions).
- Migration refuses drift in its two existing dependency bodies; readback confirms unchanged MD5 hashes `9d32cc8c26d4668a16503682a5fa765c` (issuance) and `498f5632c9c12a1937755e0b0503c438` (start). No historical revision or permit is rewritten.
- Independent production rollback-only check confirms all three new entry points refuse to appropriate an existing operator pilot as a customer command. No account unpause, run, permit or command was created by this check.
- Fresh post-migration readback: AVGAR generation 1, paused; three runs, three artifacts, three verified original permits, zero commands, zero enabled routines. New customer permit trigger is present/enabled. Security advisors remain 16 INFO / 6 WARN; unrelated warnings are not cleared or called resolved.

## Verification

- **212 files / 2,707 unit tests pass**, both application and standalone worker TypeScript pass, focused ESLint/diff checks pass.
- Existing 36 Node operator/preflight tests still pass after the shared-code extraction.
- New unit tests run the actual customer router → queue → processor → keyword engine path with fake storage/provider I/O, separately for US/NZ/AU; assert one command-bound issuance, two optional reads, one n8n call, no built-in fallback and no outward executor call. Their fake `needs` response is not a completed business artifact or live provider evidence.
- `node scripts/verify-keyword-command.mjs /tmp/unc-manual-pg.x8Y6jR` runs exact production RPC/permit migrations on an isolated real PostgreSQL server with minimal dependency tables. Twenty checks pass: identity/market/expiry/queued-hash/switch/owner/pause/generation/registration/channel refusal; independently observed transaction lock waiting and one issuance/start winner; switch-off at dispatch and provider-authority boundaries; one authority consumption; separate NZ/AU allowances. No production credentials or external provider calls. Minimal dependency tables are not a full production-schema test.
- The first local attempt revealed a missing `approval_id` column in the test bootstrap, not a production migration error; the fixture was corrected and rerun successfully. The cluster is stopped after each run.

## Next activation gates — still Codex work

1. Install the reviewed canonical keyword specification into the existing account's saved routine configuration using an explicit owner/context/configuration check. No saved spec or switch was changed in this batch. Choose/display the market clearly; do not silently substitute a country or expose arbitrary recipe editing as authorization.
2. Ship matching app/worker source with the command release scope empty/off first; verify compatibility, flags, health and normal customer reads. No app/worker deployment was performed in this batch.
3. Configure the exact accepted customer scope and conduct a bounded signed-in request → correct one-use run → real artifact/receipt → reload test, plus disabled-switch and duplicate acceptance. The existing three operator runs are not this proof.
4. Coordinate any Nguyen output correction/new revision before repinning; no n8n workflow was edited, published or invoked here. Do not refetch provider data merely to correct output wording/SEO interpretation.
5. Continue later lane adapters, shared data/freshness, cost/scheduling/security/retention/channel/second-client acceptance. No new external-action authority follows from these RPCs or from turning on a read/draft switch.
