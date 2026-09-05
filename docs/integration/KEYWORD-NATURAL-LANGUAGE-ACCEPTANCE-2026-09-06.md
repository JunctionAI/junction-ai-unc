# Keyword customer conversation acceptance — Batch 66

PASS for one supervised US plain-language customer journey. Full B01–B24/all-client
launch remains open. The previous contractor
opinion turn did not advance backend state; this turn resumes live acceptance.

## Authority and bounds

Tom's standing instruction authorizes completing the read/draft pilot through the
customer app using existing connections. This is not a new owner approval or an
external-action release. Perform one signed-in plain-language request for the
saved US keyword setup; at most one new DataForSEO task. Do not fall back to an
operator-issued permit or a second request after an uncertain outcome.

Temporary command scope: AVGAR `aa5cfc84-2569-4c99-9b40-67003ae55eda`, generation
1, app only, D03-W01 v2, expiry `2026-09-05T20:20:00.000Z`.
Saved specification hash:
`1e3117a6834bd0062a90b67972feb277c353160ca82907d8191b8f32d21fd8a3`.
Workflow-selection hash:
`c446dd03c35b8d93a09f31f7044e0c2820dc34ce1ac5c5381bd963ef67c4abf1`.
Frozen executing revision `ac771cd3-8899-4401-915c-40d4477e48e2`.
Use the existing model budget, not an invented business/ad budget.

Before changing configuration, read-only preflight at 19:56:05.775 UTC confirmed
matching runtime `aa3fba419a1cbb8d5a1d4c27dbb363bc3626f92a`, worker release 38,
reviewed workflow hash `da1bfb8235a056dfcc3745281970ecf9cf33bc3e4b1b2c117675a5c58686ba5c`,
all five flags false, and only the intentional account-pause blocker. Fresh DB/UI
show seven verified permits/results, one historical done command, zero enabled
routines, and the saved US recipe. No provider calls in preflight.

## Procedure and rollback

1. Build a same-code production-config candidate without domain assignment,
   scoped commands only; verify health and anonymous denial before promotion.
2. Configure the existing sole worker with the same exact scope and unchanged
   image. Preserve all outward-action flags false and all existing credentials.
3. Lift only AVGAR's setup pause after owner/generation/spec/no-outstanding-work
   checks. Select only the keyword routine through the actual customer UI.
4. Submit one plain-language request using saved settings. Inspect that original
   command/run until terminal; no new ID to work around an uncertain result.
5. Switch off in the UI; verify refusal while the command scope remains active.
   Verify result/history reload and original-command deduplication independently.
6. Restore account pause, zero switches, worker commands false/scopes empty, and
   canonical commands-off deployment `dpl_2nmd4t7GiyKmbRubE7MEzbLv4Xef`.
   Do not overwrite historical receipts or saved market settings.

No Nguyen edit/publication, new credential, outward message, payment/contract
change, or extra paid contractor scope is included. Preserve any inconclusive
execution for reconciliation rather than retrying it.

## Live customer evidence

The verified owner selected only “Find searches you can win” in Agents. Database
readback: D03-W01 enabled at `2026-09-05T19:58:36.991271Z`. The actual Ask screen
received this exact plain-language message once while enabled:

> please run the keyword opportunity scan using my saved settings and prepare the draft for me.

No slash command, operator permit or direct service-role enqueue substituted for
the customer request. The real classifier selected the saved routine. Unc first
reported queued, then automatically added its completed-draft response in the same
conversation. The worker's ordinary queue tick consumed it; no manual tick kick.

| Evidence | Observed identity |
|---|---|
| Request UUID | `caa4eefd-65f9-4199-a871-1932d5452a68` |
| Command and run | `2be496e1-ccfd-5a2c-aef3-e9e8cf3996c3` |
| Queued | `2026-09-05T19:59:05.987Z` |
| Started / finished | `19:59:44.084Z` / `19:59:53.111Z` |
| Command done | `19:59:53.277Z` |
| Permit | `f2fb2d79-a646-4d9d-a4c5-e4182ef204de`, verified |
| n8n | [Execution 84](https://junctionai8.app.n8n.cloud/workflow/XiXJKuph1fAeH9pe/executions/84) |
| Artifact | `b94eeac7-50af-4fb3-a5d5-4dfb6fdca49a` |
| Provider task | `09051959-2436-0607-0000-38bb255444e2` |
| Original request digest | `d52080d93b1de2da8a99ea0d72d1297a3bc962490083c59a98323dd2bd4129ca` |

One provider task, about 47 seconds from queued to completed (38 seconds waiting
for the worker tick; about nine executing). This is not instant-response latency.
The model budget preflight confirmed the existing US$15 environment cap with
US$14.771952 remaining; no cap was raised or business budget supplied.

At 19:59:28.789 UTC, read-only replay of the original actor/request through the
actual compiled shared dispatcher returned the same queued command. Throwing
interpreter/enqueue sentinels were never called: zero reclassification, enqueue
or provider calls. This is shared-dispatch deduplication, **not authenticated HTTP
duplicate delivery or a lost-response/reload recovery test**.

The owner UI switched D03-W01 off at `20:00:23.642924Z`. A fresh Ask submission of
the same plain-language text, while the temporary command release remained active,
received “Keyword opportunity scan is switched off.” No second new command or
provider run appeared. The two total commands include historical #80.

After restoring the hold, full browser reload preserved both the completion and
switch-off refusal. Today showed eight completed runs/eight drafts, zero enabled
routines and zero runs needing attention. Work inbox opened the latest US draft,
with actual paid competition, separate organic difficulty, unknown CPC currency,
pending page match and no invented AVGAR ranking/CTR claim. Historical artifacts
remain unchanged, including their older wording; no evidence was overwritten.
The customer's “Why?” control revealed both the exact DataForSEO task/source
timestamps and the named n8n execution 84 link. The generic body still exposes
technical field names and renders underscores as Markdown emphasis; customer
presentation needs improvement and is not accepted as polished launch copy.

Independent verifier at **20:01:19.767 UTC**:
`node scripts/verify-reviewed-keyword-execution.mjs 2be496e1-ccfd-5a2c-aef3-e9e8cf3996c3 84 US`
passed on the actual worker. It compared the authenticated saved execution's
request/revision/published-builder hash and actual output against the original
stored artifact and five receipts. Six DB reads, one n8n GET, zero new provider
calls/writes. `workflowVersion` was verified from the execution record, not echoed.

## Deployment result and restoration

- URL: https://junction-kb74mebum-tom-junctionmedis-projects.vercel.app
- Target: production configuration, temporary scoped customer test.
- Status: READY; `dpl_F79bSab55qWvZviXYmvGRFgdS94F`.
- Commit: `aa3fba419a1cbb8d5a1d4c27dbb363bc3626f92a` (unchanged runtime code).
- Framework: Next.js 16.3.4; build duration 34 seconds.
- Candidate health passed; anonymous keyword configuration returned 401 with
  private/no-store. Then canonical promotion succeeded.
- Worker: sole machine `1857466fd76998`, unchanged image
  `sha256:f8e2e6b08d8da299594e7c0ef80be51455597320c56d4fbfe11c6c8b658abcaf`.
  Direct machine config updates retained release metadata 38; they were not image
  rebuilds. Scope was read back inside the worker before the customer run.
- Restored canonical commands-off `dpl_2nmd4t7GiyKmbRubE7MEzbLv4Xef` and worker
  commands false/scopes `[]`; all four outward-action flags false throughout.
- At 20:01:38.566 UTC canonical health matches source, DB healthy, worker fresh
  (35 seconds), no last error. Machine started with all five flags false.
- At 20:01:52.005721 UTC SQL: paused, generation 1 preserved, zero enabled
  routines/unresolved permits, two commands, eight done runs/artifacts, 40 receipts.
- Bounded candidate error/fatal scan since 19:57 UTC returned no entries.
  Authenticated `/v1/drains` remains empty. Alert delivery/ongoing monitoring is
  still an open requirement, not established by this short clean window.

Runtime source was unchanged, so the existing full tests/typechecks were reused;
this batch's new evidence is the real customer/worker/provider readback, not a
fresh claim of full regression coverage. Documentation diff checks pass.

## Remaining work

This closes the missing supervised natural-language success proof for this exact
US recipe/revision, not overall B03/B24 or self-serve launch. Durable chat recovery
after a lost POST response/reload, customer-friendly linked results and useful
keyword/page recommendations remain. No UK/other seed/market inference is allowed;
NZ/AU have prior operator evidence, not this customer-conversation acceptance.

Next independent journey: bind the existing native Klaviyo account and complete
the callable calendar receiver/adaptor against its already implemented ledger;
then integrate the other delivered lanes. Broader connection freshness, sync,
metrics, cost, scheduling, security/retention, channels and second-client proof
remain in the full register. No need to ask Nguyen to redesign the keyword wrapper.
