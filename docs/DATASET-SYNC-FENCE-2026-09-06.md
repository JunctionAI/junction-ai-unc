# Dataset completion fencing — B09 / B16

6 September NZ / 5 September UTC. This closes a specific sync acceptance race,
not the full storage, refresh cadence, ingestion coverage or backend register.

## Implemented and verified

Previously `syncDataset` claimed a 120-second distributed lease, fetched a provider
result, checked connector identity and inserted directly. A worker could finish
after expiry or replacement of that lease and still save its result.

The worker now uses service-only `commit_dataset_sync(jsonb,uuid,bigint)` for all
normal dataset saves. It locks the account and connector, checks captured context
generation and pause/connection/asset identity, then locks the exact query lease.
Holder and expiry are checked using database wall time **after** those locks are
acquired. Successful insertion and lease consumption share one transaction.
A rejected/uncertain RPC never falls back to direct insertion or provider retry.
Source timestamps and rows are preserved; storage time comes from the database.
Existing freshness/day/normalization checks remain, with additional database
validation of source time, provenance, shape and current Meta budget normalization.

This does not cancel an HTTP request already in flight. Lease expiry may permit a
successor to start another fetch; preventing overlap/billing for long paginated
requests requires separate bounded fetch/renewal work. The new guarantee is that
the superseded holder cannot accept data or release the successor's lease.
Historical rows and the separate audited saved-data correction procedure are not
rewritten. Shared raw snapshots remain asset/query-bound, not context-versioned
historical business recommendations.

## Evidence

- 216 Vitest files / **2,828 tests** pass; application and worker TypeScript pass;
  changed-file ESLint, script syntax and diff checks pass.
- `scripts/verify-dataset-sync-fence.mjs /tmp/unc-manual-pg.x8Y6jR`: **31 real
  PostgreSQL checks** pass against the exact foundation and new migration.
  Synthetic isolated cluster only, zero remote DB/provider/n8n calls.
- Tests include actual anon/member denial, valid server acceptance, preserved
  source timestamps, server storage time, replay, replaced/expired/missing holder,
  pause/generation/asset/tenant/query rejection, malformed/stale source rejection,
  two concurrent completions with one winner, independently observed account /
  connector / lease lock waits crossing expiry, authority changes committed during
  lock waits, and successor survival/completion.
- Production project `ycgayfsvcjpsnryrpukv`: applied migration **20260905165626**,
  source `20260905165333_dataset_sync_commit_fence.sql`.
- Independent catalog read at **2026-09-05T16:57:03.611394Z** matches function-body
  MD5 `c30c01bae0ed5047a1d4f31248830409`; security invoker, empty search path,
  anon/member EXECUTE false, service EXECUTE true. Existing grants/RLS unchanged.
- Production service-role rollback-only refusal using the existing saved snapshot
  passed while AVGAR remained paused. No accepted snapshot, new lease, provider
  fetch, context change or workflow invocation. Readback: generation 1, paused,
  four datasets, four runs, one command.
- Security advisor baseline and post-migration read both **16 INFO / 6 WARN**;
  no new-function finding. Existing advisories remain separate launch work.

## Release and remaining work

**Released and independently checked:** worker source
`78687e415076c1f2d6132bcead90915e0e5a5ffb`, Fly **release 31**, sole Sydney machine
`1857466fd76998`, image
`sha256:0d1203fa6c2bd9d1c94f4357cb8fee80f29f72c1acd00a7a4136986ed1507692`.
Remote container compilation, alias validation, rolling smoke and health checks
passed. Built from an isolated clean Git worktree, preserving the unrelated
untracked `src/lib/runtime/context 2.ts` outside the image.

At **16:59:56.549Z**, `scripts/verify-dataset-sync-worker.cjs` ran inside the actual
worker. It asserted the source SHA and disabled flags, read AVGAR's paused context
and existing saved snapshot, and invoked the compiled `DbDatasetStore.save` with
an unowned sentinel holder. Exactly one new RPC reached the server and was refused;
no lease claim, direct insertion, provider/n8n call or account change. This proves
the deployed code uses the fence, not merely that the RPC exists. Success/concurrent
acceptance remains synthetic local proof; no new live provider fetch was needed.

Canonical app health at **16:59:56.360Z**: app remains `bb538e2e3638`, database
healthy, worker heartbeat fresh at 22 seconds, one completed tick, no last error.
Independent SQL at **17:00:07.206817Z**: AVGAR paused/generation 1, zero enabled
routines, four datasets/four runs/one command. Machine started and health passing.
Sync/reader allowlists absent; all five external-action/command flags false.
`UNC_COMMAND_RELEASE_SCOPES` is absent in the deployed config (previously `[]`);
its existing default remains deny-all, not an expanded release scope.

The app does not invoke
`DbDatasetStore.save` / `syncDataset`; its existing budget-correction deployment
remains compatible with this additive RPC. No reason to rebuild/promote the app
for this worker-only behavior change. Keep sync/reader allowlists, commands,
messaging and external-action switches unchanged. No n8n edit, repin or run.

Rollback can use prior worker release 30/image
`sha256:30b3fc937427ec3c4debe539d6d894cad74e3142d99265faa82ab1a6dfd201ba`
while sync remains disabled. That rollback loses this completion fence; it is not
safe to present it as retaining the fix. The additive RPC can remain installed.

Next: finish source coverage/cadence and the remaining routine adapters. No scheduled-refresh or
all-client acceptance is claimed by these concurrency tests.

## Nguyen review continuity

Recovered terminal session 59304 completed successfully. Its authenticated
read-only export at **16:50:11.586Z** confirmed published revision
`e5ae41ae-d025-4231-9f5c-99589c43e88a`, definition hash
`fac94aaa603e5497004428213c2b665d95919aa6779b6007836526ce299d5301`.
Replacing only the output builder with saved execution 80's builder reconstructs
the earlier verified hash
`85c5010892e9d6c8d467a69e480ef57307192b23ddf6250f9c0f4561867f58b5`.
Thus the definition outside that builder is unchanged; differences in n8n's
expanded saved-node defaults are not additional workflow edits. Five n8n GETs,
zero provider calls/invocations. Output-quality review and accessible handoff
files remain pending; no acceptance or repin follows from a definition diff alone.
