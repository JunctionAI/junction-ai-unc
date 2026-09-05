# Saved-work history release

The Work inbox now offers a read-only history view across drafts, run approvals, runs and execution receipts. It uses a 50-row timestamp/type/ID cursor, retaining microsecond timestamps and a created-through boundary. Newer/older navigation and restart-from-newest are available. It is not a frozen audit export; record status can change and late arrivals require refreshing from newest. No historical approval or draft control runs work or sends anything.

Account/generation headers, current session and database membership are checked; membership/context are rechecked after the read. The SQL function independently requires the supplied server-owned actor's current membership. Anonymous/authenticated database roles cannot call it directly. Paused owners/members can inspect history. Internal run snapshots and raw receipt payloads are excluded. Failed reads are unavailable, never an empty/success state. Cursor validation is not an authorization credential.

## Verified before release

- Full unit suite: 210 files / 2,646 tests passed. App and worker TypeScript passed; production webpack build passed.
- Ten workspace browser tests passed, including the new paging/error cases and explicit disabled historical Approve/Hold controls. Connected-browser DOM inspection rendered the labelled synthetic history view. The optional agent-browser CLI was unavailable; existing browser tooling was used, with no new dependency installed.
- Real local PostgreSQL canary traversed 124 records sharing a microsecond timestamp without skipping/duplicating, checked upper boundary, foreign actor/generation/partial-cursor denial, paused member reads and omitted private inputs. Minimal local tables are not a production schema substitute.
- Applied production migration `20260905144436_workspace_history`, source `20260905143724_workspace_history.sql`. The same synthetic canary passed against actual production schema inside a rollback transaction. Afterwards: seven accounts, zero runs and zero canary accounts. Actual function is security-invoker, service-role executable, denied to anon/authenticated; no underlying table grants changed.
- Security advisors unchanged: 16 INFO / 6 WARN. Existing warnings concern public vector extension, existing callable definer helpers and leaked-password protection; this is not global security sign-off. See [function exposure guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Live release and readback — 6 September NZ

Source `ac16b16620e04d1cbcbbecf08adc713b20c6adfe` is deployed coherently:

- Vercel `dpl_AcPu4CLmCGaBrfWYh3YYjtJoC8pH`, candidate `https://junction-am1usm2kj-tom-junctionmedis-projects.vercel.app`, promoted to `https://junction-unc.vercel.app` after candidate health and unauthenticated history 401 / private-no-store checks passed.
- Fly release **23**, existing machine `1857466fd76998`, one machine started with its health check passing.
- Exact worker image digest: `registry.fly.io/unc-worker@sha256:65cea85bce2ea056fc15e76f6cbcbbafb80d8e0aac5d2ac8afaf5bd38e0ae6e3`, tag `deployment-01M1S0GW3PDH4YXRY9MV9EG5M6`. Actual process reports the full matching source. All five external-action flags and the execution reader remain false.
- Canonical health at `2026-09-05T14:51:22.974Z`: correct source, database OK, fresh worker, no last error. Deployment error-level scan returned no entries; alert/drain delivery remains separately unverified.
- Signed-in AVGAR generation-one owner opened Work inbox → Browse full saved history; loading resolved to the true zero-record page. Back to recent work and reopening after full reload passed. Actual production screenshot inspected. This is empty-state production acceptance, not a claim of nonempty provider history.
- Independent production readback retained seven accounts, zero runs/artifacts/registrations/permits and the paused AVGAR generation-one context.

Rollback app: `dpl_CBWkHhrgFEq4DPYmjGMwAMeGfwSH`; previous worker source `3408671a5569dc94ce6eac2e54bea52d5162e6a3`, image digest `8e3be68bbce10bc5eb1924091ce0492c25ee085d260b1b7063109070752cec5e`. Keep the additive schema and coordinated receiver secret; do not restore obsolete credentials or legacy client writes.

## Remaining acceptance

App/worker release and authenticated empty-state UI readback pass. **Batch 44 follow-up:** [three real provider-produced keyword drafts/runs/receipts](integration/KEYWORD-LIVE-PILOT-2026-09-06.md) now appear in history after reload; the initial nonempty provider-history gate passes. Customer useful-output and governed review acceptance remain separate gates. Nguyen retains workflow ownership pending handoff acknowledgement; Codex did not edit his workflow. No credential, account pause, routine switch or external-action flag was changed by the history release itself; the later pilot's bounded pause windows are separately recorded.
