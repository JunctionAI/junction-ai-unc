# Context-generation app release — 5 September 2026

Scope: one verified stage of the active 24-item backend goal. Not a completed AVGAR repair or launch acceptance. Supabase guidance informed the invoker/least-privilege guard and additive/enforcement split; Next.js and React guidance informed authenticated route and captured-request handling.

## Deploy result

- URL: https://junction-unc.vercel.app/app
- Deployment URL: https://junction-csoilf3kd-tom-junctionmedis-projects.vercel.app
- Target: production, existing `junction-unc` project `prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d`
- Status: READY, promoted; canonical health independently verified
- Deployment: `dpl_GFhVcW2yijx1SJKVUTuWAaSJNTYE`
- Commit: `2bcbed838f7fde22e2a6950b2d44eb65554407fa`
- Framework: Next.js 16.3.4
- Build duration: 33 seconds

Built with production configuration and `--skip-domain`, tested via the protected deployment, then promoted. No production secrets were copied into a preview environment. Only the release SHA was explicitly supplied; no action flags were enabled. GitHub branch: https://github.com/JunctionAI/junction-ai-unc/tree/codex/backend-foundation-20260905

## Database and user-path evidence

1. Applied additive `20260905031145_account_context_generation_guard`. Pilot generation stayed 0, original state revision stayed 4; no memory trigger installed yet. Initial old-app browser preflight then caused the old redundant save, moving revision to 5.
2. Replacement candidate health returned source `2bcbed838f7f`, healthy DB, fresh old-worker heartbeat. Unauthenticated account state returned 401. Disabled messaging webhook returned 503 `messaging_disabled`.
3. Promoted the candidate; canonical health independently reported the same source. Existing owner session loaded successfully.
4. Applied `20260905031418_account_context_memory_enforcement` only after promotion. Direct browser memory mutations are denied; reads/RLS are unchanged. The trigger is SECURITY INVOKER with empty search path and no public execute grant. It uses account-row locking; authenticated users were not granted account UPDATE to make that work.
5. `scripts/verify-context-generation.sql` passed actual database role checks: legacy service generation-zero compatibility before repair; delayed default-zero and captured-old writes rejected after repair; immutable account/generation; monotonic generations; revision/replay invalidation with and without existing metadata; current-generation service writes accepted. All synthetic rows rolled back; independent readback found zero context canary accounts.
6. Both previous atomic-save/enforcement SQL canaries passed again after the new grants.
7. Live owner added a neutral temporary verification marker through the UI/API after enforcement. Row `7f97af8c-7e10-4d58-9f1a-cd2b22711e26`, generation 0, created `2026-09-05T03:14:33.239Z`. The owner UI's Forget action ended it at `03:15:01.261Z`; it disappeared from active UI and has non-null `valid_to` in SQL. History remains recoverable; no existing memory was deleted.
8. Reloading the new app did not autosave: revision remained **5**, last save **03:12:00.735904Z**. This validates removal of initial no-op writes, not full simultaneous multi-tab recovery.
9. Routine command count remained zero. Connector identity/status fingerprint before/after was `e2db714e52c03d4502a260ab2e1d99f6` for `md5(string_agg(id::text||platform||status,',' order by id))`. No secret values were read into logs, changed or transferred.

Local validation: 179 test files / **2,092 tests**, app and standalone worker typechecks, production build all pass. Lint: 0 errors / 39 existing warnings. Fake-database tests verify captured generation propagation; real SQL canaries verify enforcement. Neither substitutes for multi-connection contention tests.

## Post-deploy observability

- Error scan: no error/fatal entries returned for this deployment in the bounded scan starting `03:13:00Z` through approximately `03:15Z`.
- Drains: zero (`/v1/drains` returned an empty list).
- Monitoring: gaps remain; no alert-delivery/retention proof is claimed and no logs were sent to a new third party.
- Security advisors after enforcement: 6 WARN / 7 INFO, same categories as before. Outstanding [definer exposure](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable), [authenticated definer review](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable), [extension placement](https://supabase.com/docs/guides/database/database-linter?lint=0014_extension_in_public) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) remain B20 work. Do not widen server-only table access to remove INFO notices.

## Recovery and remaining acceptance

Before memory enforcement, the previous atomic app `dpl_2yLzCP8TqcS6Go3DeHtvRzN4qbZX` was a usable fallback. **After enforcement its session-role manual-memory writer is incompatible.** Prefer forward repair or this generation-aware release; do not blindly restore direct-memory grants or promote older browser-direct code. Generations must never be decremented to make an old binary run.

The pilot is still generation 0 with Junction business context. The old Fly worker is unchanged. No production publishing, customer messaging, ad mutation or spend activation was enabled; Nguyen's workflows were not touched.

Before repair, cover/quiesce old worker runs, artifacts/briefs, founder notes, intake and command admission. The memory wrapper explicitly does not fence those tables. A repair must first lock the account, save a restricted restore snapshot, close old-context memory validity and archive/remove old active history/results, then advance generation atomically. Do not turn historical Junction advice into AVGAR context by changing its generation label. US/NZ/AU and the 50%-of-product-price CPA rule are approved; product/currency binding, search seed and an actual commercial target still need evidence.
