/* eslint-disable @typescript-eslint/no-require-imports -- Runs inside the standalone worker. */
/** Read-only deployed-path check. No live schedule/provider run is authorized.
 * Set EXPECTED_UNC_BUILD_SHA; only the pinned project's database GETs are allowed.
 * Explicit helper flags below are function arguments, not environment changes. */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { DbAccountsSource } = require('/app/dist/worker/worker/accounts.js');
const { SupabaseStore } = require('/app/dist/worker/lib/runtime/store/supabase.js');
const { runDatasetSyncTick, scheduledDatasetsReady, inspectAccountDatasets } = require('/app/dist/worker/worker/datasets.js');

(async () => {
  const expected = process.env.EXPECTED_UNC_BUILD_SHA;
  assert.match(expected || '', /^[a-f0-9]{40}$/);
  assert.equal(process.env.UNC_BUILD_SHA, expected);
  const origin = 'https://ycgayfsvcjpsnryrpukv.supabase.co';
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, origin);
  for (const key of ['UNC_COMMANDS_ENABLED', 'UNC_MESSAGING_ENABLED', 'LIVE_MODE_ENABLED', 'TNZ_SMS_ENABLED', 'APPLE_MESSAGES_ENABLED'])
    assert.equal(process.env[key], 'false');
  for (const key of ['UNC_DATA_SYNC_ENABLED', 'UNC_DATA_SYNC_ACCOUNTS', 'UNC_STORED_DATA_ACCOUNTS'])
    assert.ok(!process.env[key] || process.env[key] === 'false');
  const accountId = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  let databaseGets = 0, forbiddenAttempts = 0;
  const fail = () => { forbiddenAttempts++; throw new Error('No provider or credential access is allowed by this check'); };
  const db = createClient(origin, process.env.SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async (input, init) => {
      const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
      const method = init?.method || (input instanceof Request ? input.method : 'GET');
      assert.equal(method, 'GET'); assert.equal(url.origin, origin);
      assert.ok(['/rest/v1/accounts', '/rest/v1/resource_profiles', '/rest/v1/team_members', '/rest/v1/routine_states',
        '/rest/v1/connectors', '/rest/v1/account_dataset_snapshots'].includes(url.pathname));
      databaseGets++;
      return fetch(input, init);
    } },
  });
  const accounts = new DbAccountsSource(db), account = await accounts.getAccount(accountId);
  assert.equal(account?.automationPaused, true); assert.equal(account.account.contextGeneration, 1);
  const deps = { db, store: new SupabaseStore(db), accounts, credentials: { get: fail }, fetch: fail };
  assert.deepEqual(await runDatasetSyncTick(deps), { synced: 0, failed: 0 });
  // Even if admitted to sync, this actually paused account remains excluded.
  assert.deepEqual(await runDatasetSyncTick({ ...deps, accounts: { getAccount: accounts.getAccount.bind(accounts), listAccounts: async () => [account] } },
    { UNC_DATA_SYNC_ENABLED: 'true', UNC_DATA_SYNC_ACCOUNTS: accountId }), { synced: 0, failed: 0 });
  assert.equal(await scheduledDatasetsReady(deps, accountId, 'D02-W01', { UNC_STORED_DATA_ACCOUNTS: accountId }), false);
  const report = await inspectAccountDatasets(deps, accountId, ['D02-W01']);
  assert.equal(report.accountPaused, true);
  assert.equal(forbiddenAttempts, 0);
  console.log(JSON.stringify({ status: 'PASS', checkedAt: new Date().toISOString(), build: expected, databaseGets,
    actualPausedAccountExcluded: true, actualRuntimeSyncOff: true, scopedReadinessRefuses: true,
    queryReadiness: report.queries.map(q => ({ availability: q.availability, maxAgeMs: q.maxAgeMs })),
    providerCalls: 0, credentialResolutions: 0, writes: 0, liveScheduleAcceptance: false }));
})().catch(() => { console.error('Read-only worker schedule check failed; details suppressed'); process.exitCode = 1; });
