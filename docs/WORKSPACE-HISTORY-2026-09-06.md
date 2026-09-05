# Saved-work history release

The Work inbox now offers a read-only history view across drafts, run approvals, runs and execution receipts. It uses a 50-row timestamp/type/ID cursor, retaining microsecond timestamps and a created-through boundary. Newer/older navigation and restart-from-newest are available. It is not a frozen audit export; record status can change and late arrivals require refreshing from newest. No historical approval or draft control runs work or sends anything.

Account/generation headers, current session and database membership are checked; membership/context are rechecked after the read. The SQL function independently requires the supplied server-owned actor's current membership. Anonymous/authenticated database roles cannot call it directly. Paused owners/members can inspect history. Internal run snapshots and raw receipt payloads are excluded. Failed reads are unavailable, never an empty/success state. Cursor validation is not an authorization credential.

## Verified before release

- Full unit suite: 210 files / 2,646 tests passed. App and worker TypeScript passed; production webpack build passed.
- Ten workspace browser tests passed, including the new paging/error cases and explicit disabled historical Approve/Hold controls. Connected-browser visual check rendered the labelled synthetic history view. The optional agent-browser CLI was unavailable; existing browser tooling was used, with no new dependency installed.
- Real local PostgreSQL canary traversed 124 records sharing a microsecond timestamp without skipping/duplicating, checked upper boundary, foreign actor/generation/partial-cursor denial, paused member reads and omitted private inputs. Minimal local tables are not a production schema substitute.
- Applied production migration `20260905144436_workspace_history`, source `20260905143724_workspace_history.sql`. The same synthetic canary passed against actual production schema inside a rollback transaction. Afterwards: seven accounts, zero runs and zero canary accounts. Actual function is security-invoker, service-role executable, denied to anon/authenticated; no underlying table grants changed.
- Security advisors unchanged: 16 INFO / 6 WARN. Existing warnings concern public vector extension, existing callable definer helpers and leaked-password protection; this is not global security sign-off. See [function exposure guidance](https://supabase.com/docs/guides/database/database-linter?lint=0028_anon_security_definer_function_executable) and [password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection).

## Remaining acceptance

App/worker release and authenticated production UI readback are pending at this source checkpoint. No real provider-produced history exists yet; the first authorized n8n run and customer useful-output acceptance remain separate gates. Nguyen retains workflow ownership; the discussion about takeover did not authorize changing it. No workflow, credential, account pause, routine switch or external-action flag was changed.
