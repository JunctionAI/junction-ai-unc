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

## Proposed schedule interface (not wired)

Existing `dueRoutines()` is UTC cron and skips `manual`. The Content adapter spec is cadence `manual`, so **enabled Content routines will not fire from the generic scheduler**. Do not add a second scheduler or change `src/worker/scheduler.ts` yet.

Proposed seam in `src/lib/n8n/contentSchedule.ts` (pure, uncalled from `loop.ts`):

```
contentScheduleDue(now, candidates) → ContentScheduleDue[]
contentScheduleApproval(due, authorizedBy, now) → ContentApproval
```

| Concern | Proposal |
|---|---|
| Timezone | Local Monday 08:00 via `contentWeeklySlotUtc`, same offset math as daily brief (`account_profiles.cadence.timezone`, else UTC). Catalog `WEEKLY_MON` (`0 8 * * 1` UTC) is not used. |
| Duplicate | Idempotency `content-schedule:{routineId}:{market}:{slotISO}` into `issue_content_shadow_run`. In-flight unique per account/generation/routine. `lastRunStartedAt` / `lastRunInFlight` still apply. |
| Notifications | After verified completion, reuse worker `TickRunReport` + existing draft receipts. No new Slack/outbox. Shape: `{ accountId, routineId, runId, slot, artifactId, status, channel: "app" }`. |

Later loop change (not this commit): exclude AVGAR D01-W02/D01-W03 from generic `dueRoutines`, call `contentScheduleDue`, then the existing reservation/start path.

## Tests vs real provider execution

| Suite | Class |
|---|---|
| `contentShadow.test.ts`, `contentCommand.test.ts`, `contentSchedule.test.ts` | **Simulated** (fakes, no provider) |
| `scripts/verify-content-shadow-admission.mjs` | **Real local PostgreSQL** (isolated cluster; no remote DB / n8n / DataForSEO) |

## Exact missing receiver requirements (Nguyen)

Publish two **new** Unc receivers. Do not edit the live TEST workflow that produced #68.

1. `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow`
2. `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow`

Each must POST `/api/n8n/content-shadow-authority`, run DataForSEO SERP for the contracted seed/location, and return only that routine’s Unc kind (`hook_list` / `question_list`) plus `executionReceipt`. Search hypotheses only. Return published revision, webhook node IDs, and US/NZ/AU fixtures for `golf travel bag`. Keep #68 untouched.

## Remaining blockers

- Receivers above are not published; env tokens/URLs/node IDs are not pinned.
- Migration is in git only — not applied to production.
- Command-release scope, unpause, and live DataForSEO round-trip are still operator-gated.
- Schedule seam is specified, not hooked into `loop.ts`.
- Email stays deferred.
