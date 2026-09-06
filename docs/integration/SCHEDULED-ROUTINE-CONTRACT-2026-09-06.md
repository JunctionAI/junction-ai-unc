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

## Still required

Live one-off timer -> keyword provider -> saved result -> original Slack thread;
customer-facing authenticated schedule editor/save flow; independent language
classification test; production ad-action workflows remain a separate capability.
No ongoing schedule was selected by Tom; he requested a one-off test now.
