# AVGAR context repair and matched release — 5 September 2026

Status: **PARTIAL backend acceptance**. The context repair, existing-connection reads and owner chat/reload are proven. This does not establish n8n dispatch, ongoing sync, phone delivery, complete UI truthfulness or launch readiness.

## Deploy result

| Field | Evidence |
|---|---|
| URL | https://junction-unc.vercel.app/app |
| Candidate URL | https://junction-ipj0s7jiv-tom-junctionmedis-projects.vercel.app |
| Target | Production, existing `junction-unc` project |
| Status | READY and promoted; canonical health readback passed |
| Deployment | `dpl_AXxQQHr4PLaUpTX584AayfbGmSSs` |
| Source | `da799c992b75587055240a033134917ee228f6b3` |
| Framework | Next.js 16.3.4 |
| Build duration | 53.448 seconds (`buildingAt` → `ready`) |
| Worker | Existing Fly `unc-worker`, Sydney machine `1857466fd76998`, v8 |
| Exact image | `registry.fly.io/unc-worker@sha256:a206c908e1377f04183873cb3a2fc13611e2e9aacf99f5a364664ce4bf15144d` |
| Worker identity | Health reports the full same source SHA; ticks advanced 1 → 2 with zero runs started |

The preceding `cd893c1` app candidate was not promoted. A remote Docker check correctly rejected a non-relative import in the standalone worker; the import was fixed and the image rebuilt. The selected candidate used production configuration with `--skip-domain`; no production secrets were copied to a preview environment.

Fly applied the exact image but its CLI later returned unauthorized during lease renewal/final smoke checks. Instead of replaying the mutation, separate machine status, configuration and HTTP health reads confirmed the intended state: one existing machine, running v8, passing service check, expected digest and source. `UNC_COMMANDS_ENABLED`, `UNC_MESSAGING_ENABLED`, `LIVE_MODE_ENABLED`, `TNZ_SMS_ENABLED` and `APPLE_MESSAGES_ENABLED` all remain `false`. The previously staged `N8N_SHADOW_RECEIVER_TOKEN` is now deployed; no secret value was printed, changed or repurposed. That secret alone is not a callable workflow integration.

## Database repair and recovery

Applied migrations:

- Live `20260905033152_account_automation_pause` (repository file `20260905032814_account_automation_pause.sql`).
- Live `20260905033435_unknown_business_resources` (repository file `20260905033403_unknown_business_resources.sql`).

The operator repair `scripts/repair-avgar-context.sql` was rehearsed with a transaction rollback. An early rehearsal's exact-revision assertion was corrected: pre-existing row triggers may advance revision more than once, so the invariant is advancement plus cleared replay markers. The corrected rehearsal passed. It was then applied once to account `aa5cfc84-2569-4c99-9b40-67003ae55eda` at `2026-09-05T03:43:44.585771Z`.

Recovery archive: `unc_private.context_repairs.id = e56cac77-1940-41b4-99db-677aa30e4222`. The private schema/table have no public, anonymous or authenticated access; original rows contain no connector-secret rows. Captured counts: 1 account, 1 business profile, 1 resource profile, 1 account profile, 1 state metadata, 1 goal, 1 plan, 2 team members, 24 memories, 8 chat messages, 1 artifact, 1 daily brief, 14 runs, 54 receipts, 5 outcomes and 7 routine states (other captured arrays empty).

The active mixed-context goal/team/chat/results/receipt history was removed only after preserving this archive. Original memories remain with closed validity. This is recoverable administrative archival, not a verified automated restore facility; B21 still needs a restore test. Existing certified provider datasets/KPIs, connections, encrypted credentials and memberships were retained. The old history was not rebranded as AVGAR work.

Independent readback confirmed:

- Account/profile `AVGAR Sport`, website `https://avgarsport.com/`, generation **1**, automation paused.
- US/NZ/AU and a CPA ceiling ratio of 0.5 recorded as founder-approved constraints. No seed, numeric CPA, scaling target, budget, hours, margin or growth target was invented.
- Budget/hours/margin are NULL; no goal, plan phases or plan agreement; zero enabled routines.
- Five active current-generation identity/policy/unknown-setting memories; no active old-generation memory.
- Connector and credential hashes exactly match the archived pre-repair fingerprints. Unrelated context-table hashes were checked within the same transaction.

Pause enforcement passed real service-role insert/update/delete/reassignment denial tests, while turn-off and draft-only plan edits remained allowed. Atomic-save and generation SQL canaries passed again, including NULL resource values; all synthetic rows rolled back. The pause is not a substitute for generation fencing. Keep it set until delayed/in-flight runtime writes and all admission paths are covered. Do not decrement generation for rollback.

After these schema/context changes, prefer forward repair with the generation-aware, pause-aware app/worker pair. Do not blindly promote pre-enforcement apps or redeploy the old worker. The old image reference is retained only for investigation: `registry.fly.io/unc-worker:deployment-01M1N91AEXTMADADNY8Q6FWKW7`.

## Live acceptance evidence

- Candidate `/api/health`: healthy database, source `da799c992b75`; unauthenticated `/api/account/state`: **401**; POST `/api/webhooks/apple`: **503 apple_channel_not_ready**.
- Canonical health independently reports the same source.
- Existing connections passed a pre-repair read and a post-repair read. Post-repair check `2701c7bd-24dc-49bc-abac-c6b26f75fced`, `03:44:14.807Z`–`03:44:16.454Z`: Shopify `avgar-sport.myshopify.com` returned 13 seven-day order rows; Meta `act_3235248400060604` returned two campaign insight rows. Both used real provider provenance, GET-only requests, and no database/auth/provider mutation. Aggregate metrics are diagnostic only, not an approved CPA calculation or a reconciliation sign-off.
- The owner browser displays AVGAR Sport, zero routines and the explicit automation-pause banner. Chat identified AVGAR, US/NZ/AU, the CPA policy and unknown budget/hours/margin/goal. It did not run a workflow.
- User chat row `3f5be0e8-fa85-4503-b96e-73ce1b8da0d7` at `03:44:37.309523Z`; reply `d575894f-6cea-46cc-97d7-815306d0e976` at `03:44:46.282015Z`. SQL and browser reload confirmed both persisted. The reply's wording must not be interpreted as a live product-price verification; no product-specific CPA was computed.
- After reload: generation 1, pause true, revision **14** unchanged, two chat rows, zero commands/runs/briefs, no regenerated goal or plan, unknown resources still NULL.

## Post-deploy observability and unfinished work

- Bounded error and fatal scans for this deployment from `03:41Z` through approximately `03:46Z` returned no entries. This is not proof of continuous alert coverage.
- Vercel drains: zero. No log data was sent to a new vendor. Alert delivery and retention remain unverified.
- Security advisors after migrations: six existing WARN/eight INFO. The added private archive's RLS-with-no-client-policy notice is intentional. Existing [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) require targeted follow-up.
- Live UI found false claims: Home derives template phases despite an empty stored plan; setup counts five connected-status rows rather than two usable asset-bound connections; it promises nightly/within-hour work while paused. Fix before customer acceptance. The backend/ordinary chat no longer uses that template as the stored account plan.
- The independent n8n execution-record reader remains unwired; the bridge fails before dispatch without it. Nguyen's wrapper revision clarification is documented in `KEYWORD-SHADOW-INTEGRATION.md`; no Nguyen workflow was changed or run.
- Full B01–B24 goal stays active. Next: UI readiness truth, captured-generation runtime fencing, authenticated n8n revision evidence, then remaining connector/sync/dispatch/recovery/phone and second-tenant acceptance gates.

Supabase guidance informed the restricted archive, transaction rehearsal and role-boundary checks; Next.js/React guidance informed server-owned pause/context and hydration behavior; Vercel deployment/environment guidance informed unaliased preflight and matching release/readback.
