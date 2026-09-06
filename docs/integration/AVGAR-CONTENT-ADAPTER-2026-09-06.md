# AVGAR Content adapter — 6 September 2026

Isolated branch work. Not deployed. No live n8n, Slack, credential or production-database change.
Historical n8n execution **#68 is not proof of this contract**.

## Exact mappings (not invented)

| Unc ID | Catalog name | Artifact kind | Existing n8n | Historical evidence | Current seed |
|---|---|---|---|---|---|
| D01-W02 | Viral hook mining | `hook_list` | `lMXjTgd3Qh4vZaMp` rev `c8d6955d-0033-47ce-9672-399f7f10118c` | exec #68 / #58; packaged `content_hooks` | must be `golf travel bag` |
| D01-W03 | Customer-question mining | `question_list` | same workflow/revision | exec #68 PAA; packaged `content_questions` | must be `golf travel bag` |

No n8n mapping exists for D01-W01, D01-W04–W08. Email/Klaviyo stays deferred.

## Admission SQL (this commit)

Migration `supabase/migrations/20260906030000_content_shadow_admission.sql` defines `issue_content_shadow_run` and `transition_content_shadow` (`start` / `dispatch` / `authorize` / `checkpoint` / `finish`). Ledger `n8n_content_runs` is service-role only. AVGAR account `aa5cfc84-2569-4c99-9b40-67003ae55eda` is pinned. Real local PostgreSQL: `scripts/verify-content-shadow-admission.mjs`. FakeSupabase vitest remains **simulated**.

## Schedule: reuse the shared saved-schedule path (not wired; no Monday 08:00 loop)

The shared `routine_schedules` + `routine_schedule_claims` + existing worker command queue already ran AVGAR keyword automatically (n8n execution **#100**, command/run `635774fe-c6f0-5738-a826-bff419e474ad`, one-off schedule `139a41a8-a81c-46dc-850f-1a80a4b9c37a`). That row is **keyword-only**. Content must later reuse the same path with customer-selected IANA timezone/hour/minute/optional weekday/`on_date`, routine-switch checks, and `schedule:{id}:{revision}:{localDate}` duplicate protection.

`src/lib/n8n/contentSchedule.ts` only maps an already-claimed saved slot onto `ContentApproval`. It does **not** select due slots, does **not** assume catalog `WEEKLY_MON` (`0 8 * * 1` UTC / Monday 08:00), and is **not** called from `loop.ts` / `scheduler.ts`. Do not invent a second Content scheduler. `UNC_ROUTINE_SCHEDULES_ENABLED` stays operator-gated.

| Concern | Reuse |
|---|---|
| Timing | Customer-selected on `routine_schedules`. Not catalog Monday 08:00. |
| Duplicate | Shared claim-per-local-date; Content admission idempotency is the claimed `schedule:` request ID. |
| Switch / owner / context | Same pre-execution checks as keyword. A switched-off Content schedule must not issue a provider allowance. |
| Notifications | Existing worker completion summary + draft receipts. No new Slack/outbox. |

## Tests vs real provider execution

| Suite | Class |
|---|---|
| `contentShadow.test.ts`, `contentCommand.test.ts`, `contentSchedule.test.ts`, `contentReceiverFixtures.test.ts` | **Simulated** (fakes, no provider) |
| `scripts/verify-content-shadow-admission.mjs` | **Real local PostgreSQL** (isolated cluster; no remote DB / n8n / DataForSEO) |

## Exact missing receiver requirements (Nguyen)

**Proposed, unpublished** URLs (do not treat as live):

1. `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow`
2. `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow`

**Published — do not send D01 here:** `POST https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow` (`XiXJKuph1fAeH9pe`). Historical TEST `lMXjTgd3Qh4vZaMp` / exec #68 is not this contract.

Frozen request/response/authority examples, US/NZ/AU separated, seed `golf travel bag`: [NGUYEN-CONTENT-RECEIVERS-2026-09-06.md](NGUYEN-CONTENT-RECEIVERS-2026-09-06.md) and `docs/integration/receivers/content-search-shadow.v1/`. Each receiver must POST `https://junction-unc.vercel.app/api/n8n/content-shadow-authority` (not keyword GET `/api/n8n/shadow-authority`), run DataForSEO SERP for the contracted seed/location, and return only that routine’s Unc kind (`hook_list` / `question_list`) plus `executionReceipt`. Empty SERP is `{needs:[…]}`. Keep #68 and keyword #100 untouched.

## Remaining blockers

- Receivers above are **proposed / unpublished**; env tokens/URLs/node IDs are not pinned.
- Migration `1782d38` is in git only — not applied to production. Codex will review SQL and rerun local PostgreSQL checks.
- Command-release scope, unpause, and live DataForSEO round-trip are still operator-gated.
- Content is not yet bound onto `routine_schedules`. Do not wire a Content loop.
- Email stays deferred.
