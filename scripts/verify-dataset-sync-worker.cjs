/* eslint-disable @typescript-eslint/no-require-imports -- Executed as CommonJS inside the standalone Node worker. */
/** Run inside the existing worker. Uses its compiled store and server-only DB
 * credentials; no credential export, provider read, lease claim or flag change.
 * The sole RPC must refuse an unowned sentinel holder while AVGAR stays paused. */
const assert = require('node:assert/strict');
const { createClient } = require('@supabase/supabase-js');
const { DbDatasetStore } = require('/app/dist/worker/lib/data/datasets.js');

(async () => {
  assert.equal(process.env.UNC_BUILD_SHA, '78687e415076c1f2d6132bcead90915e0e5a5ffb');
  assert.equal(process.env.NEXT_PUBLIC_SUPABASE_URL, 'https://ycgayfsvcjpsnryrpukv.supabase.co');
  for (const key of ['UNC_COMMANDS_ENABLED', 'UNC_MESSAGING_ENABLED', 'LIVE_MODE_ENABLED', 'TNZ_SMS_ENABLED', 'APPLE_MESSAGES_ENABLED'])
    assert.equal(process.env[key], 'false');
  for (const key of ['UNC_DATA_SYNC_ENABLED', 'UNC_DATA_SYNC_ACCOUNTS', 'UNC_STORED_DATA_ACCOUNTS'])
    assert(!process.env[key] || process.env[key] === 'false');
  const accountId = 'aa5cfc84-2569-4c99-9b40-67003ae55eda';
  const holder = '00000000-0000-0000-0000-000000000000'; // Never issued by claimLease/randomUUID.
  const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false, autoRefreshToken: false } });
  const accountRead = () => db.from('accounts').select('id,context_generation,automation_paused').eq('id', accountId).single();
  const account = await accountRead();
  assert.equal(account.error, null); assert.equal(account.data.automation_paused, true); assert.equal(account.data.context_generation, 1);
  const snapshot = await db.from('account_dataset_snapshots').select('*').eq('account_id', accountId)
    .eq('id', 'a1223279-93b6-59fe-a6a2-089222fe77f3').single();
  assert.equal(snapshot.error, null);
  const row = snapshot.data;
  const key = `dataset:${accountId}:${row.connector_id}:${row.query_hash}`;
  const lease = await db.from('backend_leases').select('holder').eq('lease_key', key).eq('holder', holder).maybeSingle();
  assert.equal(lease.error, null); assert.equal(lease.data, null);
  let rpcCalls = 0;
  const store = new DbDatasetStore({
    from() { throw Error('Direct table insertion is prohibited'); },
    rpc(name, args) {
      assert.equal(name, 'commit_dataset_sync'); assert.equal(++rpcCalls, 1);
      assert.equal(args.p_holder, holder); assert.equal(args.p_snapshot.account_id, accountId);
      assert.equal(args.p_context_generation, 1);
      return db.rpc(name, args);
    },
  });
  await assert.rejects(store.save({ accountId, connectorId: row.connector_id, externalRef: row.external_ref, platform: row.platform },
    row.query, row.query_hash, { ...row.result, fetchedAt: row.source_fetched_at }, new Date(), { holder, contextGeneration: 1 }),
    /dataset sync completion refused: lease expired or account\/connection changed/);
  assert.equal(rpcCalls, 1);
  const after = await accountRead();
  assert.equal(after.error, null); assert.deepEqual(after.data, account.data);
  console.log(JSON.stringify({ status: 'PASS', checkedAt: new Date().toISOString(), build: process.env.UNC_BUILD_SHA,
    compiledStore: true, serverRefusal: true, rpcCalls, accountPaused: true, contextGeneration: 1,
    providerCalls: 0, leaseClaims: 0, directInserts: 0, n8nCalls: 0, actionFlags: 'disabled' }));
})().catch(() => { console.error('Worker completion-fence verification failed; diagnostic details suppressed'); process.exitCode = 1; });
