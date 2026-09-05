# Whole provider-read deadlines — Batch 58

## Reproduction and change

Per-request timeouts did not impose a deadline across credential resolution,
multiple pages, JSON bodies and final credential validation. Four baseline tests
failed: a five-page read succeeded beyond its total limit; pending credentials and
bodies did not settle by the deadline; the HTTP helper discarded an already-aborted
request signal. Baseline failures were observed before changing implementation.

`WorkerConnectorReader` now defaults to a 30-second whole-read limit. It races the
operation against a deadline, aborts the request signal and checks elapsed time
before/after credential validation. The elapsed-time check also rejects a late
result when synchronous parsing delays the timer callback. The HTTP helper combines
whole-read cancellation with existing request cancellation and per-request timeout;
it checks cancellation before accepting a response or parsed body.

The deadline does not permit partial output, follow-on page requests after expiry,
or acceptance of late completion. `syncDataset` receives the rejection and cannot
write the late result; its existing lease cooldown and atomic save fence remain.
No new provider call, credential configuration, live switch, database schema or
action permission is part of this change.

## Scope limits

This bounds the reader caller and cooperatively aborts native HTTP. It cannot
preempt synchronous JavaScript, cancel an arbitrary custom credential/DB promise,
or undo a token-refresh request already in flight. Such late work cannot trigger
a later data fetch or become an accepted read through this wrapper. Existing
credential/database completion fencing remains necessary.

It is not a hard deadline for the entire worker tick: database enumeration,
multiple separate reads, other jobs and downstream storage have their own bounds.
The shared app and worker service both instantiate this reader, so both are released.
No dependency version changes or n8n redesign are required.

## Tests and source

- 221 files / 2,888 Vitest tests pass; app and worker TypeScript, focused ESLint
  and diff checks pass.
- Fourteen added tests cover pagination, late credential/body completion, successful
  cleanup, pre-aborted requests, no late dataset commit, final grant validation,
  delayed timer callbacks, five invalid limits, and real native HTTP body abort.
- The native HTTP test uses a temporary loopback server and no provider endpoint.
  Other transports/accounts are synthetic; production data was not refreshed.
- Source `d86b2f6b4f8466a3b2b03b9022939922556f3508` pushed; independent remote matches.
  Clean release worktree `/private/tmp/unc-reader-deadline-release.EPr4s8` excludes
  unrelated user file `src/lib/runtime/context 2.ts` and local secret files.
- The deployed-worker verifier adds a synthetic slow-body read, checks the compiled
  default limit and aborted signal, then awaits late body completion without
  another fetch. Its separate live section remains GET-only with runtime flags off.

## Release

Matching app and worker release completed. Vercel deployment guidance was used to
stage and health-check the app before promotion, without disabling protection.

- App: `dpl_68UEr2NZLMxs2wNvBi4EjfWvKGWQ`, source `d86b2f6b4f84`, Next 16.3.4,
  42-second build, READY and promoted to https://junction-unc.vercel.app/app.
  Immutable URL: https://junction-in4beptqc-tom-junctionmedis-projects.vercel.app.
- Worker: release 35, sole Sydney machine `1857466fd76998`, started/health passing,
  matching full source SHA, image
  `sha256:e167bae69c7d21fb97df96657c1f6ad79a7a2fa0b996b3ea709cfd2196d46044`, tag
  `deployment-01M1SAZXYWQDT7NTSVSXT35M48`.
- Actual compiled-worker verification `2026-09-05T17:50:30.210Z`: synthetic whole-read
  deadline and missing-connection isolation PASS. Separate actual-account checks
  use 30 database GETs, no provider calls/credential resolutions/writes, and verify
  paused AVGAR and disabled action/sync flags. Both proposed Meta datasets are stale.
- Candidate connector endpoint returns anonymous 401 and `cache-control: no-store`.
  Canonical health `17:51:02.177Z` matches the app source, database healthy, worker
  fresh (54 seconds, one tick, no reported last error).
- Signed-in AVGAR reload at 17:51 UTC retains four work items, four completed shadow
  runs and zero enabled routines, with pause and disabled-action notices. SQL at
  `17:51:21.968550Z` independently retains generation 1, pause, four runs/four datasets
  and zero enabled routines. No fresh provider result is implied.
- Error/fatal log query since 17:50 UTC returned no entries. Drains are still zero;
  ongoing alert delivery remains unverified. A short clean log window is not an
  operating SLA or scheduled-run acceptance.

Rollback references: app `dpl_F82eaB3bwpEHEYknxPvXTtrEPue6`, source `75d4f3c87f88`;
worker release 34, source `20ba9c9c4815f9f88458ca4eeba7b7c911a674d1`, image
`sha256:1fbc717c8886efa32cce1f5a0fba2230fe4b1b81b59e59970a191ea8cb2adc1c`.

Broader provider coverage, real authorized refresh cadence/restart acceptance,
remaining lane adapters, account enumeration/fairness and client/channel acceptance
remain open. The full B01–B24/all-client goal is not complete.
