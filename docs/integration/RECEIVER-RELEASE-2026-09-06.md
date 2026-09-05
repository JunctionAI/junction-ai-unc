# Receiver replacement and manual-admission release — Batch 38

6 September 2026 NZ / 5 September UTC. **PARTIAL**, not full launch acceptance.

## Authority and boundaries

Tom answered the exact receiver-replacement approval question with “Approve anything you need to do”. This authorizes replacing that receiver secret across n8n/Vercel/Fly. Publishing, customer messaging, ad mutation/spend activation remain disabled. Nguyen retains workflow ownership. His 1:53 AM reply withdrew the earlier 54-character claim: it was the n8n redaction sentinel, not plaintext.

The n8n credential/security skill informed use of the existing encrypted native credential, not workflow text. The Vercel environment skill informed production-only Sensitive storage. The lifecycle/debugging skills informed checking saved executions, current configuration and source before a further test or revision change.

## Production database and code

- Source: `3408671a5569dc94ce6eac2e54bea52d5162e6a3`; prior source verification: 209 files / 2,626 tests, app/worker types, webpack build and real independent PostgreSQL concurrency checks. See `../MANUAL-RECOVERY-ACCEPTANCE-2026-09-06.md`; no new full-suite invocation this batch.
- Supabase project `ycgayfsvcjpsnryrpukv`: applied migration `20260905140440_manual_routine_admission`, from repository `20260905124522_manual_routine_admission.sql`, SHA256 `87f8686addbf909e253dbb2b59d0ad70e6cb3964036e1b8def5afd2bc1718611`. Before/after rollback-only SQL canaries pass. Independent readback confirms seven accounts, two memberships, zero runs/requests/cancellations/canaries, AVGAR paused/generation 1. Both manual tables have RLS; anon/member reads/writes denied. Four manual RPCs remain invoker/service-executable only.
- Advisors changed 14 → 16 INFO, unchanged six WARN. New INFO: RLS enabled without policies on the two service-only tables. Do not add customer permissions merely to silence these findings. Existing warnings remain open.
- Vercel production app: `dpl_CBWkHhrgFEq4DPYmjGMwAMeGfwSH`, immutable `https://junction-78ebi9w5t-tom-junctionmedis-projects.vercel.app`, promoted to `https://junction-unc.vercel.app`. Candidate `dpl_71nqYUjPgSwdpaSqh3p95B2hVfV9` had a null fingerprint and was not promoted; replacement explicitly binds the actual source SHA at build/runtime. Build succeeds. Canonical health at `2026-09-05T14:12:40.681Z`: SHA `3408671a5569`, DB healthy, worker fresh.
- Fly: existing machine `1857466fd76998`, syd, single machine. Image `registry.fly.io/unc-worker@sha256:8e3be68bbce10bc5eb1924091ce0492c25ee085d260b1b7063109070752cec5e`, build SHA matches. Code release 21, receiver-secret update release 22; image unchanged by secret update. All five action flags false; reader false; no runs started.
- Signed-in canonical Today after reload shows `halltaylor.tom@gmail.com`, AVGAR Sport, generation 1, paused, zero routines/runs/reviews and disabled-action banner. This is not nonempty manual/phone/provider acceptance.

Rollback references: app `dpl_EDhJQqkpGZ74FUbWAK8NK6TgK3R7` / source `4284dcbc50c43f648dbcf678e603df2d8d8e2534`; worker release 20 image `registry.fly.io/unc-worker@sha256:d882624a87f8d270973bfd574a068eced262fc9917c66d721c69e277d5babab3`. Rolling back code must retain the coordinated new receiver secret and compatible additive schema; do not restore an unverified old credential. No rollback was performed.

## Secret provisioning evidence

One cryptographically generated 32-byte base64url raw token (43 characters): full `Bearer ` value entered into native Header Auth credential `Unc — AVGAR shadow receiver` / `Y9Xu3zApLSrcWu1e`; raw token sent through private stdin to Vercel Production Sensitive update and Fly secret import. Credential UI reports updated just now. No provider credential, signing root or workflow binding changed.

Worker one-use HMAC challenge matches the privately held new value; correct length, separate signing root, reader disabled and all action flags false. Private variable cleared after provisioning. Secret not included in this document, source, command arguments or chat. Reopened password DOM is masked and does not establish stored plaintext equality; do not treat its length as evidence.

Fresh read-only API verification at `2026-09-05T14:11:06.726Z`: current/published wrapper `XiXJKuph1fAeH9pe`, revision `1bce8c54-637e-4770-af90-2da36f38369a`, webhook node `c934c229-1191-43b7-b035-5fc641fbe0d0`, same credential ID. Saved #75 and #59 readable; users read forbidden. This is not a successful new shadow execution.

## Real transport blocker and Nguyen handoff

The first deliberate missing-dataToken probe returned a non-JSON response; the verifier reported uncertain rather than retrying. Independent saved-execution list still ended at #75. A second no-authority diagnostic captured **403, plain text `Authorization data is wrong!`**, with no valid run context or paid-call allowance. No DataForSEO execution occurred.

Current published trigger parameters include `options.ignoreBots=true`. [n8n webhook source](https://github.com/n8n-io/n8n/blob/master/packages/nodes-base/nodes/Webhook/Webhook.node.ts) checks `isbot(user-agent)` and emits this 403 before validating credentials; [issue 36363](https://github.com/n8n-io/n8n/issues/36363) documents the misleading message. This is a concrete server-to-server compatibility blocker, not proof the new bearer is wrong or correct. Successful authentication must still be tested after correction.

Sent and independently read back on Upwork: receiver replacement/status update at 2:11 AM NZ, followed by exact request to disable Ignore Bots only, preserve Header Auth, pinned origin and all authority checks, validate/republish and provide a new frozen revision. Codex did not edit/republish or impersonate a browser user agent. Nguyen's reply/new revision remains pending at this checkpoint.

Next gates: verify revision diff/new pin, receiver auth/refusal behavior, matching signing/authority configuration, approved pilot unpause/admission, three separate US/NZ/AU `golf travel bag` calls and independent original-run artifact/receipt acceptance. Reader, registrations, switches and routines remain disabled/unissued until ready. The broader B01–B24/all-client goal remains active.
