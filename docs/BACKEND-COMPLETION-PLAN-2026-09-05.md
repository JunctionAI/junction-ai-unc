# Unc backend completion: Codex, Nguyen and Tom

Status at 5 September 2026, approximately 14:20 NZST. This is the current known blocker inventory, not a claim that untested paths are defect-free. Backend first; platform redesign follows the pilot acceptance gate.

**Execution goal is active.** Subsequent work and remaining handoff gates are tracked in `docs/BACKEND-GOAL-PROGRESS.md`; the snapshot below remains the original evidence baseline.

## Outcome and boundaries

Tom confirmed during this work: **US, NZ and AU; maximum CPA = 50% of the relevant product price**. See `docs/integration/AVGAR-PILOT-POLICY.md` for the currency/product-binding requirements. A keyword seed, a separate scaling target and product-to-ad mapping are not implied by this confirmation.

A customer signs in, connects each required platform, selects the right business assets, chooses routines, and talks to Unc. Unc resolves the correct customer, permissions and enabled routines; structured workflows use the correct data; results return to the same customer with evidence. Approval-controlled actions are a later, separately tested capability.

We build independent routines plus explicit dependencies, **not a workflow for every 1/8, 2/8, 3/8 combination**. Eight toggles imply 256 subsets, but only eight implementations. Test each routine, dependency boundaries, representative combinations, all-off/all-on, and conflicts. A disabled routine cannot be silently switched on by another routine or by the model.

The model interprets requests and explains outcomes. It does not decide tenant identity, choose arbitrary credentials, grant permissions, bypass a disabled switch, or certify that an action happened.

Current scope remains read/draft/shadow. No publishing, customer messaging, ad mutation or spending activation was enabled during this work. No Nguyen workflow was edited, executed or registered during this audit. Messages to Tom in the eventual pilot channel and outward customer campaigns are separate authorities.

## Fresh evidence

| Check | Observed result |
|---|---|
| Production app | Healthy; `/api/health` reported SHA `91d7ef60cde5`, not the latest source branch. |
| Worker | `unc-worker`, Sydney machine `1857466fd76998`, running with a fresh heartbeat. Health is not workflow execution proof. |
| Runtime controls | Fly lists commands, messaging, SMS, Apple and live mode disabled. Source also hard-disables live actions. |
| n8n registry | Zero rows in `n8n_workflows`; zero queued commands at the initial audit. |
| AVGAR identity | Pilot account `aa5cfc84-2569-4c99-9b40-67003ae55eda`, owner `halltaylor.tom@gmail.com`. Meta `act_3235248400060604`; Shopify `avgar-sport.myshopify.com`. |
| Existing credential reads | 02:12 UTC: Shopify 13 order rows and Meta two campaign insight rows, live provider provenance, no auth writes/provider mutations. Check `ce666c07-abe8-4d99-becc-3115d17c327d`. |
| Incorrect context | The same account still has business profile `Junction AI`, category `AI Marketing & Sales Automation`, and resource website `getjunction.ai`. Do not run customer advice against this mixed identity. |
| Other connector records | GA4 needs reconnection and has no selected external reference. Instagram, TikTok and YouTube have connected records without an external reference or verified read evidence. These rows alone are not ready connections. |
| Shared-data live canary | One ad-set-level Meta query persisted three rows. Snapshot `3f346547-ac99-4d95-96a3-1da67f0ca601`, source time `2026-09-05T02:14:42.005Z`. A second sync reused it; two new readers used it without another provider query; another account was rejected. |
| Database safety | New server-only tables/RPCs applied as `20260905021314_backend_data_foundation`. Real SQL canary passed lease ownership/expiry, token compare-and-swap, disconnect guard and dataset identity checks. Disposable test rows rolled back; independent readback found none remaining. |
| Security advisors | Six existing WARN and seven INFO items after the migration. Two new INFO items describe intentional RLS-with-no-client-policies on server-only tables; actual client grants were denied and tested. Existing warnings still need targeted review. |

Nguyen's Meta 6/8, SEO 4/6, content, Google Ads and Klaviyo results remain **his reported shadow evidence**, not proof those workflows are connected to the production Unc app.

## Changes completed in this batch

1. Token access distinguishes temporary/provider outages from confirmed invalid grants and operator configuration errors. Temporary errors preserve the connection; only a real reconnection condition asks the customer to reconnect. Concurrent calls sharing a process/database client are coalesced.
2. Added optional database-backed refresh leases and atomic ciphertext replacement. An expired owner or changed/disconnected connector cannot overwrite a newer token through that path. This needs coordinated activation across all refresh owners; copied OAuth grants across different connector records remain a separate issue.
3. Added durable, tenant/connector/query-bound reporting snapshots. The stored reader refuses stale, mismatched, missing or unverified data; it does not silently fall back to a provider call. Both the worker reader and n8n data proxy have this opt-in path.
4. Added a bounded background sync job deriving Meta queries from enabled routine specifications, with per-query leases/cooldown. It does not dispatch workflows, call a model or execute actions. One query may paginate. Scheduling flags remain off.
5. Meta reads now reject incomplete pagination/missing spend, preserve unknown purchase values, and avoid presenting nonexistent insight budgets or campaign IDs as actionable ad-set/ad facts. This does not complete every derived metric or filter in the catalog.
6. Added a generated, regression-tested inventory of all 35 routine IDs, reads, scopes and pre-n8n steps: `docs/integration/unc-routine-manifest.v1.json`.
7. Added repeatable live verification scripts and real database security checks. Stabilized an existing brief test whose September 4 approval fixture had expired against the real clock.

Code changes are staged for release in `codex/backend-foundation-20260905`. Schema plus one explicit snapshot canary are live; app/worker deployment and ongoing snapshot routing are **not** claimed complete.

Verification: **175 test files / 2,060 tests passed**, app and standalone-worker TypeScript passed, production webpack build passed, lint had zero errors (39 existing warnings), and `git diff --check` passed. Synthetic tests and the database/data canaries do not constitute a live n8n workflow or phone acceptance test.

## Full known bottleneck/task register

P0 = required for a truthful, useful AVGAR read/draft pilot. P1 = required for the broader self-serve/ongoing product. P2 = required before external actions or wider scale. `Codex` means Tom does not need to operate a technical console for this task.

| ID | Priority | Bottleneck / current gap | Owner and next task | Acceptance evidence |
|---|---|---|---|---|
| B01 | P0 | AVGAR credentials are paired with Junction business context. | **Codex:** preserve existing context, repair pilot identity/website/profile, review memories/goals/plan for cross-business contamination. **Tom:** supply commercial targets, not technical configuration. | Persisted AVGAR profile and context endpoint agree with selected assets; unrelated account data unchanged. |
| B02 | P0 | Production code is behind the source containing the new bridge/security work. | **Codex:** release a tested app/worker pair with schema compatibility and rollback reference. | App and worker build IDs match the approved release; auth/read/chat smoke checks pass; all action flags remain off. |
| B03 | P0 | Chat command dispatch is off; conversation-to-routine-to-result is unproven live. | **Codex, after the first callable routine:** enable only the intended pilot scope and verify signed-in/channel identity, switch state, duplicate handling and result delivery. | One request creates one correct run and reloadable artifact/receipt; disabled routine produces an honest refusal. |
| B04 | P0 | Nguyen's proven TEST workflows are not registered production-callable Unc routines. | **Nguyen:** deliver authenticated keyword-only entry point first, actual revision and success/failure receipts. **Codex:** bind and test it after delivery. | One real Unc-to-n8n-to-provider-to-Unc shadow round trip, independently read back. |
| B05 | P0 | Registering an n8n produce-step webhook does not replace earlier Unc checks/decisions. Some Meta checks require unavailable metrics. | **Codex:** own explicit shadow adapters. **Nguyen:** state which decisions his lane owns and return their evidence. Use the new manifest; do not bypass permission/approval gates. | Each integrated lane is reached on real input; no silent pre-check skip or fallback draft is called an n8n success. |
| B06 | P0/P1 | Credential ownership and account binding differ between existing n8n and Unc connections. | **Codex + Nguyen:** record one credential/refresh owner and verified asset binding per platform/account. Retain existing native n8n credentials for the AVGAR pilot; don't export them or duplicate customer OAuth per routine. | Correct account succeeds; another tenant, unsupported asset and missing scope fail before provider work. |
| B07 | P0/P1 | Auth reliability needs coordinated rollout, not just token storage. | **Codex:** deploy recovery classification and leases; test renewable grant rotation/revocation; audit shared Google grants across connector IDs; add bounded retry and expiry/operator alerts. | Temporary failure recovers without login, expired/revoked grant asks for reconnect, concurrent processes cannot clobber a newer grant. No promise of permanent authorization. |
| B08 | P0 | Connector records can lack selected assets or read evidence. | **Codex:** verify required scopes/asset choices and surface separate consent, selection, read-health and freshness states; park unsupported/unneeded connectors. | Every advertised pilot dependency has a recent authorized read or a specific visible blocker. |
| B09 | P0/P1 | Shared data is only a Meta snapshot foundation, not full provider coverage. | **Codex:** finish query coverage, enable scheduler before switching reads, verify cache misses/staleness and instrument sync health. **Nguyen:** agree ingestion/result contracts for data only his credentials can currently read. | Multiple enabled routines reuse a certified snapshot; refresh is independent; stale data cannot masquerade as fresh. |
| B10 | P1 | Historical warehouse/backfills and durable sync cursors are incomplete. | **Codex:** design raw/normalized daily-grain data, incremental cursors, webhook reconciliation, provider/account timezone and currency handling. **Nguyen:** implement his provider extractors to that contract. | Historical totals reconcile with provider reports; late updates/backfills are idempotent and preserve provenance. |
| B11 | P0 | Metric semantics are not complete: fatigue/trend/test tags, reconciliation, attribution windows and budget joins. | **Codex + Nguyen:** agree required fields, definitions, level/grain and unknown-data behavior per lane. The current safety fixes reject partial evidence but do not synthesize missing metrics. | Golden real-input cases match provider/account facts and deterministic policy outputs, including missing data. |
| B12 | P0 per enabled lane | Provider/access coverage is uneven: GA4/GSC, Google Ads setup, CMS, AI search, creator rights and some email inputs. | **Codex:** inventory and wire existing grants first. **Nguyen:** exact missing scope/asset/input per blocked lane. **Tom:** only genuine owner consent, rights or commercial approvals. Shopify app reinstall stays parked; the existing read connection works. | Enabled lanes are ready; blocked lanes explain the single next action and never pretend to run. |
| B13 | P0 | n8n Client Config is still fixed to AVGAR/test search values. | **Codex:** supply server-verified client settings. **Nguyen:** validate them against the bound tenant; remove silent fixed-client fallbacks from callable wrappers. **Tom:** confirm seed/market and business targets. | Domain, account, market and seed agree across request, provider result and receipt. |
| B14 | P0/P1 | Cross-routine dependencies/conflicts need real combination tests. | **Codex:** implement dependency/eligibility/locking policies. **Nguyen:** independent lanes and explicit shared outputs, never combination-specific workflow copies. | All-off, single, representative combined and all-ready selections execute only allowed work; shared sync is deduplicated; conflicting proposals stay separate. |
| B15 | P0 | End-to-end artifact/receipt storage is locally tested, not proven with new n8n calls. | **Codex:** validate/store correlated run, artifact, source evidence and receipt. **Nguyen:** return actual execution/revision IDs and structured failures. | Production readback joins the right account/run/routine/workflow revision; error output cannot be presented as completed work. |
| B16 | P0/P1 | Recovery from timeout/restart/duplicate delivery needs live proof. Keyword pilot is synchronous, not a durable async callback system. | **Codex:** test queue retry/reconciliation/cancellation and account-scoped dedupe; add authenticated async completion only when required. **Nguyen:** bound retries/timeouts and report uncertain outcomes honestly. | Duplicate request/restart creates no duplicate action or artifact; timed-out work is reconciled, not blindly replayed. |
| B17 | P0/P1 | Proactive timing and ongoing health aren't established by a fresh heartbeat. | **Codex:** verify scheduler ownership, timezone/quiet hours, leases, missed-run alerts and per-routine success rates. **Nguyen:** no competing production schedules for an Unc-owned routine. | Two scheduled intervals plus restart recovery produce correct, nonduplicate evidence; failures are visible. |
| B18 | P1 | Model/provider flexibility and cheap routing need per-routine quality/cost evidence. | **Codex:** evaluate cheaper models, schema validation, fallback policy and per-account spend caps against real task cases. | Budget enforcement and usage receipts survive retries; model downgrade doesn't invent provider data or authority. |
| B19 | P0 for phone / P1 wider | Apple/SMS/Slack channel onboarding and identity are not proven end to end. | **Codex:** configure the chosen approved provider, verify phone/channel-to-account binding and reply/retry/opt-out behavior; use web app while Apple review is pending. **Tom/provider:** unavoidable approval or phone verification only. | A verified user sends one message from their phone and receives the right account's result; another identity cannot access it. |
| B20 | P0 review / P1 hardening | Database security advisories and tenant denial paths need targeted closure. | **Codex:** review definer functions/grants, password security and extension dependencies without blanket policy changes; exercise cross-tenant route/RPC tests. | Confirm intended exposure and pass denial tests; document intentional server-only INFO notices. |
| B21 | P1 | Data retention, deletion, backups and restore are not signed off. | **Codex:** define per-dataset retention/deletion/export and test restore; remove unnecessary sensitive fields. **Tom:** approve retention/commercial privacy choices if not already settled. | Recoverable restore test and a scoped client deletion/export test; tokens/PII absent from logs and exports. |
| B22 | P2 | External write executors are deliberately disabled and not launch-authorized. | **Codex + Nguyen:** build separate approved action executors with fresh provider read, expiry/caps, idempotency, object identity, before/after readback and rollback. **Tom:** approve an exact canary batch when ready. | A separately authorized bounded canary and denial/failure tests pass. A draft or shadow execution never counts as a write. |
| B23 | P1/P2 | Second-client isolation and scalable provisioning are not proven. | **Codex:** automate account/binding/config provisioning and test a second isolated tenant; review n8n capacity, licensing/embedding terms and operational cost before scale. **Nguyen:** versioned reusable templates and client-isolated credential bindings. | Second client needs no hand-edited business logic and cannot read/use AVGAR credentials, assets or snapshots. |
| B24 | P0 | No complete customer acceptance receipt exists for the released experience. | **Codex:** assemble and execute release checklist. **Tom:** use the product as a customer and judge whether the result is genuinely useful. | Sign in → connected account → chosen routine → plain-language request → correct output → reload/history → switch off, all proven on production. |

Relevant security remediation references: [server-only RLS notices](https://supabase.com/docs/guides/database/database-linter?lint=0008_rls_enabled_no_policy), [anonymous definer-function exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Work order and ownership

### Codex — continue independently

1. Deliver this tested foundation and stable contract to GitHub; preserve the old checkout and unrelated files.
2. Repair the AVGAR business-context mismatch, with an audit trail and no invented business targets.
3. Complete runtime configuration/release preflight and connector readiness. Reconcile signing/receiver configuration without exposing or blindly rotating secrets.
4. Expand and certify stored-data query coverage and sync observability. Do not switch routines to stored reads before required datasets exist and the refresher is running.
5. Prepare the exact keyword shadow registration and Meta adapter changes against Nguyen's contract. Do not publish or change his flows while he is finishing them.
6. When Nguyen returns the acceptance packet, bind one routine, run/read back the real shadow result, then expand lane by lane.
7. Own web/phone, persistence, tenant-isolation and toggle testing. Tom should not be asked to join IDs or troubleshoot infrastructure.

### Nguyen — next delivery, not an open-ended rebuild

Use `docs/integration/NGUYEN-NEXT-HANDOFF.md`. Deliver D03-W01's authenticated keyword-only wrapper first. Then the six proven Meta lanes and the other ready lanes, one versioned contract at a time. Keep existing functional provider credentials and successful business logic. Identify genuinely missing access precisely.

### Tom — only owner/product decisions

- Confirm AVGAR's search market/seed and paid-ad business targets. Codex handles the profile/website/configuration edits.
- Complete only provider consent/verification that requires the account owner; do not send passwords or secret keys in chat.
- Provide missing creator rights/CMS access only if those blocked routines are needed for the first release; otherwise leave them unavailable.
- Choose/test the first phone channel when a provider is ready; Apple review cannot be removed by code changes.
- Review the first useful real outputs, then separately approve any future outward-action canary.

## Release gates

**Gate A — AVGAR read/draft pilot:** correct context, one genuine n8n lane, matched app/worker, authenticated dispatch, fresh data, durable artifact and receipt, disabled-toggle/cross-tenant tests, Tom's useful-output check. Website chat can satisfy the first interaction gate; do not label SMS ready without testing SMS.

**Gate B — multiple routines/clients:** expand verified lanes, independent toggles/dependencies, ongoing refresh/recovery, second-client isolation, cost and support observability. No all-combinations workflow duplication.

**Gate C — external actions:** separate exact authority, fresh pre-write checks, idempotency and provider readback. All write switches stay off until this gate is deliberately approved and passed.

The aim is to make Nguyen's callable workflow delivery the next integration dependency. It is not honest yet to say he is the only remaining blocker: Unc release/context work and third-party permissions still remain.

## Rollout controls / verification commands

- `CONNECTOR_REFRESH_LEASES_ENABLED=true`: requires the applied migration and coordinated refresh-owner rollout. Default remains off.
- `UNC_DATA_SYNC_ENABLED=true`: worker sync opt-in. Also requires an explicit account in `UNC_STORED_DATA_ACCOUNTS`.
- `UNC_STORED_DATA_ACCOUNTS=<pilot account>`: switches that account's Meta reads in the app proxy/worker to exact stored snapshots. It is not a global warehouse activation.
- Snapshots use exact query plus UTC reporting day, 15-minute sync reuse and a 60-minute maximum source age. This is an initial policy, not a universal freshness SLA or historical daily fact model.
- Keep publishing/messaging/ad/live flags disabled. Do not repurpose an existing Klaviyo Header Auth credential as the Unc receiver credential.
- Run `npm test -- --no-file-parallelism`, `npx tsc -p tsconfig.worker.json`, `npm run build`, `npm run lint` and `git diff --check`.
- `scripts/verify-avgar-connections.mjs`: GET-only provider/DB-read diagnostic.
- `scripts/verify-avgar-datasets.mjs --persist-readonly-snapshot`: explicit pilot-scoped snapshot write; no auth writes/provider mutations.
- `scripts/verify-backend-foundation.sql`: server-role boundary tests with disposable rows rolled back.
