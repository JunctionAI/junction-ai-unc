/* eslint-disable @typescript-eslint/no-require-imports -- Runs inside the standalone worker. */
/** Read-only deployed-path check. No live schedule/provider run is authorized.
 * Set EXPECTED_UNC_BUILD_SHA; only the pinned project's database GETs are allowed.
 * Explicit helper flags below are function arguments, not environment changes. */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { DbAccountsSource, StaticAccountsSource } = require('/app/dist/worker/worker/accounts.js');
const { MemoryStore } = require('/app/dist/worker/lib/runtime/store/memory.js');
const { SupabaseStore } = require('/app/dist/worker/lib/runtime/store/supabase.js');
const { runDatasetSyncTick, scheduledDatasetsReady, inspectAccountDatasets } = require('/app/dist/worker/worker/datasets.js');
const { WorkerConnectorReader, DEFAULT_TOTAL_READ_TIMEOUT_MS } = require('/app/dist/worker/worker/providers/connectorReader.js');
const { readCampaignHistory } = require('/app/dist/worker/worker/readers/klaviyoCampaigns.js');
const { storedDataEnabled, datasetSyncEnabled } = require('/app/dist/worker/lib/data/datasets.js');

(async () => {
  const expected = process.env.EXPECTED_UNC_BUILD_SHA;
  assert.match(expected || '', /^[a-f0-9]{40}$/);
  assert.equal(process.env.UNC_BUILD_SHA, expected);
  const origin = 'https://ycgayfsvcjpsnryrpukv.supabase.co';
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, origin);
  for (const key of ['UNC_COMMANDS_ENABLED', 'UNC_MESSAGING_ENABLED', 'LIVE_MODE_ENABLED', 'TNZ_SMS_ENABLED', 'APPLE_MESSAGES_ENABLED'])
    assert.equal(process.env[key], 'false');
  for (const key of ['UNC_DATA_SYNC_ENABLED', 'UNC_DATA_SYNC_ACCOUNTS', 'UNC_STORED_DATA_ACCOUNTS', 'UNC_KLAVIYO_CAMPAIGN_SYNC_ACCOUNTS', 'UNC_KLAVIYO_CAMPAIGN_STORED_ACCOUNTS'])
    assert.ok(!process.env[key] || process.env[key] === 'false');
  const accountId = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  let databaseGets = 0, forbiddenAttempts = 0;
  const fail = () => { forbiddenAttempts++; throw new Error('No provider or credential access is allowed by this check'); };
  // Exercise the deployed loop's pre-provider failure isolation with wholly
  // synthetic metadata. These identities are never passed to the live database.
  const syntheticIds = ['synthetic-unbound-a', 'synthetic-unbound-b'];
  const syntheticStore = new MemoryStore(), inspectedIds = [];
  for (const id of syntheticIds) await syntheticStore.putRoutineState({ accountId: id, routineId: 'D02-W01',
    enabled: true, version: 1, liveSpec: null, draftSpec: null, updatedAt: new Date().toISOString() });
  const syntheticDb = { rpc: fail, from: table => {
    assert.equal(table, 'connectors');
    let inspectedId;
    const query = { select: () => query, eq: (key, value) => { if (key === 'account_id') inspectedId = value; return query; },
      maybeSingle: async () => { inspectedIds.push(inspectedId); return { data: null, error: null }; } };
    return query;
  } };
  assert.deepEqual(await runDatasetSyncTick({ db: syntheticDb, store: syntheticStore, credentials: { get: fail }, fetch: fail,
    accounts: new StaticAccountsSource(syntheticIds.map(id => ({ account: { accountId: id, currency: 'NZD', budgetMonthly: 0 } }))) },
    { UNC_DATA_SYNC_ENABLED: 'true', UNC_DATA_SYNC_ACCOUNTS: syntheticIds.join(',') }), { synced: 0, failed: 2 });
  assert.deepEqual(inspectedIds, syntheticIds);
  assert.equal(DEFAULT_TOTAL_READ_TIMEOUT_MS, 30000);
  let syntheticFetches = 0, deadlineSignal;
  let bodyCompleted = false;
  const deadlineReader = new WorkerConnectorReader({ totalTimeoutMs: 100,
    credentials: { get: async () => ({ kind: 'meta_ads', adAccountId: 'act_synthetic', accessToken: 'synthetic-only' }) },
    fetch: async (_input, init) => { syntheticFetches++; deadlineSignal = init.signal;
      return { ok: true, status: 200, headers: new Headers(), json: async () => {
        await new Promise(resolve => setTimeout(resolve, 200)); bodyCompleted = true; return { data: [] };
      } };
    } });
  await assert.rejects(deadlineReader.read('meta_ads', { resource: 'insights' }, { account: { accountId: 'synthetic-deadline', currency: 'NZD' } }), /total read timeout/);
  assert.equal(deadlineSignal?.aborted, true);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.equal(bodyCompleted, true);
  assert.equal(syntheticFetches, 1);
  const campaignQuery = { resource: 'campaigns', window: '90d' };
  const legacy = { UNC_STORED_DATA_ACCOUNTS: 'synthetic', UNC_DATA_SYNC_ACCOUNTS: 'synthetic', UNC_DATA_SYNC_ENABLED: 'true' };
  assert.equal(storedDataEnabled('synthetic', 'klaviyo', legacy, campaignQuery), false);
  assert.equal(datasetSyncEnabled('synthetic', 'klaviyo', legacy, campaignQuery), false);
  let syntheticCampaignFetches = 0;
  const campaign = await readCampaignHistory(campaignQuery, {}, { now: () => new Date('2026-09-06T00:00:00Z'),
    fetch: async () => { syntheticCampaignFetches++; return Response.json({ data: [{ id: 'synthetic', attributes: {
      name: 'Synthetic campaign', status: 'Sent', send_time: '2026-09-05T00:00:00Z', revenue: 999,
    } }], links: { next: null } }); } });
  assert.equal(campaign.ok, true); assert.equal(campaign.metrics.revenue, null); assert.equal(campaign.rows[0].subject, null);
  assert.equal(campaign.metrics.campaign_history_contract, 'unc.klaviyo-campaign-history.v1');
  assert.equal(syntheticCampaignFetches, 1);
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
    syntheticMissingConnectionIsolation: true,
    syntheticWholeReadDeadline: true,
    syntheticCampaignMetadata: true,
    queryReadiness: report.queries.map(q => ({ availability: q.availability, maxAgeMs: q.maxAgeMs })),
    providerCalls: 0, credentialResolutions: 0, writes: 0, liveScheduleAcceptance: false }));
})().catch(() => { console.error('Read-only worker schedule check failed; details suppressed'); process.exitCode = 1; });
