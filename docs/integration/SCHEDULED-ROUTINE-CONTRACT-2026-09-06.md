# Saved routine schedules

Priority: customer saves a schedule once; no routine code or chat message is
required per run. Current rollout is the single AVGAR keyword shadow routine.

## Shared integration

- `routine_schedules` captures owner, tenant generation, routine version/spec
  hash/workflow hash, IANA timezone, local time, optional weekday, optional one-off
  date, and an explicitly verified delivery binding.
- `routine_schedule_claims` uniquely owns schedule + revision + local date.
  Claim and command enqueue are one database transaction. No second scheduler:
  the existing worker polls saved schedules and consumes its existing command queue.
- The command request ID begins `schedule:` and is backed by that claim, never
  treated as a newly received Slack message. The current engine's manual start
  protocol is reused internally; the durable command/claim records carry the
  actual scheduled origin. Do not infer origin from `triggeredBy` alone.
- Before execution, owner/switch/context/selection/budget checks still apply.
  Revocation also closes keyword provider admission. Expired release scopes stop
  new scheduling. `UNC_ROUTINE_SCHEDULES_ENABLED` defaults off.
- Daily/weekly clocks use saved IANA timezone. Repeated DST hours have one local
  date claim; nonexistent spring-forward times are skipped, not rescheduled.
- One-off tests use `on_date`; they cannot become ongoing daily jobs.
- Completion summarises persisted artifacts without another model call and links
  to the authenticated account workspace. The link is not yet artifact-specific.

## Content handoff

Reuse this schedule/command consumer once the Content SQL and receivers are
independently verified. Do not introduce per-combination workflows or another
scheduler. Content must enforce the same schedule revocation at provider admission.

## Acceptance so far

162 focused unit tests passed. Isolated real PostgreSQL tests passed for concurrent
claim, durable command, owner context, foreign account refusal, routine off,
schedule off, old revision refusal and public-role denial. These are not live
provider evidence. Run `node scripts/verify-routine-schedules.mjs <isolated-deps>`
after compiling the worker; the script refuses non-isolated dependency paths.

## Live one-off acceptance

At 2026-09-06 03:30 UTC the saved one-off schedule
139a41a8-a81c-46dc-850f-1a80a4b9c37a fired through the normal worker timer.
Command/run 635774fe-c6f0-5738-a826-bff419e474ad completed; n8n execution 100
was independently verified. Slack readback confirmed the summary, actual keyword
candidate and account workspace link in the original SEO thread. Subsequent DB
read showed exactly one claim and one provider permit. No Slack run command was
sent. The schedule's on_date restricts it to today; no ongoing schedule approved.

Worker release: 5639e1be77af8856b3167bb6968068648d430e13,
image digest e400fa478024f3d9b893a4ff2ce1a347714d9dfd47619518c6c24445f1bcba05.
Database security advisors passed. App schedule controls are staged separately.

## Still required

Customer-facing authenticated schedule editor/save flow live UI verification; independent language
classification test; production ad-action workflows remain a separate capability.
No ongoing schedule was selected by Tom; he requested a one-off test now.
