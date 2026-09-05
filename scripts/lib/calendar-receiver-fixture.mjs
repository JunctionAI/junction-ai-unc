import { buildCalendarReceiverBundle } from './calendar-receiver-bundle.mjs';

/** Entirely synthetic Cloud compatibility test. This function is serialized into
 * a manual Code node; no outside variables, HTTP, credentials or real client IDs. */
export function runCalendarReceiverFixture(api) {
  const checks = [];
  const assert = (name, condition) => { if (!condition) throw new Error(`fixture_failed:${name}`); checks.push(name); };
  const refuses = (name, fn) => { let denied = false; try { fn(); } catch { denied = true; } assert(name, denied); };
  const clone = v => JSON.parse(JSON.stringify(v));
  const start = '2026-09-06T12:00:00.000Z', now = '2026-09-06T12:00:01.000Z', end = '2026-09-06T12:00:02.000Z';
  const pins = { accountId: '00000000-0000-4000-8000-000000000001', providerAccountId: 'synthetic-klaviyo-account',
    primaryDomain: 'example.com', workflowId: 'synthetic-calendar' };
  const shadow = { contract: 'unc.campaign-calendar-shadow.v1', accountId: pins.accountId, workflowId: pins.workflowId,
    workflowVersion: '00000000-0000-4000-8000-000000000002', routineId: 'D05-W07', routineKey: 'campaign_calendar',
    client: { primaryDomain: pins.primaryDomain, timezone: 'Pacific/Auckland', currency: 'NZD',
      bindingId: '00000000-0000-4000-8000-000000000003', klaviyoAccountId: pins.providerAccountId },
    data: { mode: 'provider', queryHash: api.CALENDAR_CAMPAIGN_QUERY_HASH } };
  const input = { accountId: pins.accountId, runId: '00000000-0000-4000-8000-000000000004',
    routineId: 'D05-W07', kind: 'calendar', mode: 'dry_run', startedAt: start, account: { currency: 'NZD' },
    shadow, dataToken: 'synthetic-not-a-real-credential-never-call' };
  const authority = { statusCode: 200, body: { ok: true, shadow: clone(shadow),
    run: { id: input.runId, accountId: pins.accountId, routineId: 'D05-W07', mode: 'dry_run', status: 'running', startedAt: start },
    authorizedAt: now, expiresAt: '2026-09-06T12:05:00Z', revisionEvidence: 'expected_only', executedAction: 'none' } };
  const page = { statusCode: 200, headers: { cid: pins.providerAccountId, 'x-klaviyo-api-revision': '2026-07-15' },
    body: { data: [{ type: 'campaign', id: 'synthetic-campaign-1', attributes: { name: 'Example | Product care', status: 'Sent',
      send_time: '2026-09-04T12:00:00Z', archived: false, subject: 'not-a-real-subject', revenue: 123456 } }], links: { next: null } } };
  const execution = { workflowId: pins.workflowId, executionId: '12345' };
  assert('valid-request', api.validateCalendarIncoming(input, pins, now).valid);
  const context = api.authorizeCalendarReceiver(authority, input, pins, now);
  assert('no-token-in-canonical-context', !JSON.stringify(context).includes(input.dataToken));
  const envelope = api.buildCalendarEnvelope(context, [page], execution, end);
  assert('six-future-local-weeks', JSON.stringify(envelope.artifact.items.map(i => i.meta.week_start)) ===
    JSON.stringify(['2026-09-14', '2026-09-21', '2026-09-28', '2026-10-05', '2026-10-12', '2026-10-19']));
  assert('six-distinct-phases', new Set(envelope.artifact.items.map(i => i.meta.phase)).size === 6);
  assert('hypotheses-not-schedules', envelope.artifact.items.every(i => i.meta.timing_basis === 'hypothesis') && envelope.artifact.meta.scheduled === false);
  assert('real-source-reference-shape', envelope.artifact.evidence[0].ref === 'klaviyo:synthetic-klaviyo-account:campaign:synthetic-campaign-1');
  assert('no-invented-performance-or-copy', !JSON.stringify(envelope).includes('123456') && !JSON.stringify(envelope).includes('not-a-real-subject'));
  const empty = clone(page); empty.body.data = [];
  const emptyResult = api.buildCalendarEnvelope(context, [empty], execution, end);
  assert('empty-is-honest', emptyResult.artifact.items.length === 6 && emptyResult.artifact.evidence.length === 0 && emptyResult.executionReceipt.provider.itemsCount === 0);
  const wrongAccount = clone(input); wrongAccount.accountId = 'other';
  assert('wrong-account-denied', !api.validateCalendarIncoming(wrongAccount, pins, now).valid);
  const wrongCurrency = clone(input); wrongCurrency.account.currency = 'USD';
  assert('business-currency-preserved', !api.validateCalendarIncoming(wrongCurrency, pins, now).valid);
  const deniedAuthority = clone(authority); deniedAuthority.statusCode = 409;
  refuses('authority-denial', () => api.authorizeCalendarReceiver(deniedAuthority, input, pins, now));
  const changedAuthority = clone(authority); changedAuthority.body.shadow.client.timezone = 'UTC';
  refuses('authority-canonical-mismatch', () => api.authorizeCalendarReceiver(changedAuthority, input, pins, now));
  const wrongProvider = clone(page); wrongProvider.headers.cid = 'other';
  refuses('provider-account-mismatch', () => api.buildCalendarEnvelope(context, [wrongProvider], execution, end));
  refuses('expired-read', () => api.buildCalendarEnvelope(context, [page], execution, '2026-09-06T12:06:00Z'));
  const next = api.CALENDAR_CAMPAIGN_URL + '&page%5Bcursor%5D=synthetic-next';
  assert('allowed-pagination', api.calendarNextPage(next) === next && api.calendarNextPage(null) === null);
  refuses('cross-host-pagination', () => api.calendarNextPage(next.replace('a.klaviyo.com', 'evil.example')));
  refuses('expanded-query-pagination', () => api.calendarNextPage(next + '&include=campaign-messages'));
  const first = clone(page), second = clone(page); first.body.links.next = next; second.body.data[0].id = 'synthetic-campaign-2';
  assert('complete-pages', api.collectCalendarCampaigns([first, second], context, end).rows.length === 2);
  refuses('incomplete-pages', () => api.collectCalendarCampaigns([first], context, end));
  second.body.data[0].id = first.body.data[0].id;
  refuses('duplicate-campaign', () => api.collectCalendarCampaigns([first, second], context, end));
  assert('dst-safe-week-spacing', api.calendarWeekStarts('2026-09-20T12:00:00Z', 'Pacific/Auckland').join(',') ===
    '2026-09-28,2026-10-05,2026-10-12,2026-10-19,2026-10-26,2026-11-02');
  assert('no-claimed-version-or-action', envelope.executionReceipt.workflowVersion === null &&
    envelope.executionReceipt.revisionEvidence === 'pending_unc_verification' && envelope.executionReceipt.executedAction === 'none');
  return { fixture: 'unc.calendar-receiver-compatibility.v1', synthetic: true, providerCalls: 0, mutations: 0,
    checks, checksPassed: checks.length, envelope };
}

export function buildCalendarReceiverFixture() {
  const bundle = buildCalendarReceiverBundle();
  const code = `// SYNTHETIC compatibility fixture: no network, credentials or real account data.\n` +
    `const api = ${bundle.expression};\nconst runFixture = ${runCalendarReceiverFixture.toString()};\n` +
    `return [{ json: { ...runFixture(api), bundleSha256: ${JSON.stringify(bundle.sha256)} } }];\n`;
  return { ...bundle, code };
}
