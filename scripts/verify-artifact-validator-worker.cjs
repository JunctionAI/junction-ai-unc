/* eslint-disable @typescript-eslint/no-require-imports -- Runs inside the standalone Node worker. */
/** Pure compiled-code checks inside the deployed worker. No provider, database,
 * n8n, lease or filesystem writes. Set EXPECTED_UNC_BUILD_SHA to the release SHA.
 * Does not prove business-output quality or independent execution verification. */
const assert = require('node:assert/strict');
const { validateArtifactObject } = require('/app/dist/worker/lib/artifacts/validate.js');
const { parseN8nReply } = require('/app/dist/worker/worker/providers/n8n.js');

const expected = process.env.EXPECTED_UNC_BUILD_SHA;
assert.match(expected || '', /^[a-f0-9]{40}$/);
assert.equal(process.env.UNC_BUILD_SHA, expected);
for (const key of ['UNC_COMMANDS_ENABLED', 'UNC_MESSAGING_ENABLED', 'LIVE_MODE_ENABLED', 'TNZ_SMS_ENABLED', 'APPLE_MESSAGES_ENABLED']) {
  assert.equal(process.env[key], 'false', key);
}
for (const key of ['UNC_DATA_SYNC_ENABLED', 'UNC_DATA_SYNC_ACCOUNTS', 'UNC_STORED_DATA_ACCOUNTS']) {
  assert.ok(!process.env[key] || process.env[key] === 'false', key);
}
assert.ok(!process.env.UNC_COMMAND_RELEASE_SCOPES || process.env.UNC_COMMAND_RELEASE_SCOPES === '[]');
const payload = { title: 'Offline contract validation', body: 'This is a synthetic contract check with no customer output.',
  items: [{ title: 'Synthetic example', body: 'Not a live provider result or customer recommendation.' }], evidence: [] };
let refused = 0;
for (const kind of [undefined, null, '', 'email_draft', 'campaign_calendar', 'made_up', 7, {}, ['email']]) {
  const artifact = { ...payload, kind };
  assert.deepEqual(validateArtifactObject(artifact, { kind: 'email', allowedNumbers: null }),
    { ok: false, reason: 'kind missing or unsupported' });
  assert.throws(() => parseN8nReply({ artifact }, 'email'), /kind missing or unsupported/);
  refused++;
}
let accepted = 0;
for (const kind of ['email', 'calendar', 'keyword_list']) {
  const artifact = { ...payload, kind };
  assert.equal(validateArtifactObject(artifact, { kind, allowedNumbers: null }).ok, true);
  assert.equal(parseN8nReply({ artifact }, kind).kind, 'artifact');
  accepted++;
}
console.log(JSON.stringify({ status: 'PASS', checkedAt: new Date().toISOString(), build: expected,
  malformedKindsRefusedThroughValidatorAndBridge: refused, validKindsAccepted: accepted,
  flags: 'commands/actions/sync/cutover disabled', databaseCalls: 0, providerCalls: 0, n8nCalls: 0, writes: 0 }));
