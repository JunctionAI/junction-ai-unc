/** Generate an INACTIVE editor-import definition. This does not create, publish,
 * register or invoke any workflow. Existing native credentials remain references. */
import { buildCalendarReceiverBundle } from './calendar-receiver-bundle.mjs';

export const CALENDAR_RECEIVER_NAME = 'CODEX — AVGAR — D05-W07 calendar shadow receiver';
export const CALENDAR_PROVIDER_CREDENTIAL = { id: '4mkTKL1q0njNafh9', name: 'Header Auth account' };
export const CALENDAR_RECEIVER_PINS = { accountId: 'aa5cfc84-2569-4c99-9b40-67003ae55eda',
  providerAccountId: 'SuYidF', primaryDomain: 'avgarsport.com' };
export const CALENDAR_AUTHORITY_URL = 'https://junction-unc.vercel.app/api/n8n/calendar-shadow-authority';
export const CALENDAR_RECEIVER_PATH = 'unc/d05-w07/calendar-shadow';

export function buildCalendarReceiverWorkflow(receiverCredential = null) {
  if (receiverCredential && (!/^[A-Za-z0-9_-]+$/.test(receiverCredential.id) || !receiverCredential.name ||
    ['4mkTKL1q0njNafh9', 'Y9Xu3zApLSrcWu1e'].includes(receiverCredential.id))) throw new Error('A distinct receiver credential is required');
  const bundle = buildCalendarReceiverBundle();
  if (bundle.expression.includes('}}')) throw new Error('Receiver source contains an n8n expression closing delimiter');
  const expr = body => `={{ (() => {\nconst api = ${bundle.expression};\nconst pins = { ...${JSON.stringify(CALENDAR_RECEIVER_PINS)}, workflowId: $workflow.id };\n${body}\n})() }}`;
  const clock = '$now.toISO()';
  const node = (name, type, typeVersion, parameters, position, extra = {}) => ({
    id: 'unc-calendar-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), name, type: `n8n-nodes-base.${type}`, typeVersion,
    parameters, position, ...extra,
  });
  const set = (name, field, value, position) => node(name, 'set', 3.4, { mode: 'manual', includeOtherFields: false,
    assignments: { assignments: [{ id: field, name: field, type: 'object', value }] }, options: {} }, position, { onError: 'continueErrorOutput' });
  const branch = (name, leftValue, position) => node(name, 'if', 2.2, { conditions: { options: { caseSensitive: true, leftValue: '', typeValidation: 'strict' },
    conditions: [{ id: 'allowed', leftValue, rightValue: true, operator: { type: 'boolean', operation: 'true', singleValue: true } }], combinator: 'and' }, options: {} },
    position, { onError: 'continueErrorOutput' });
  const respond = (name, responseCode, responseBody, position) => node(name, 'respondToWebhook', 1.5,
    { respondWith: 'json', responseBody, options: { responseCode, enableStreaming: false, responseHeaders: { entries: [{ name: 'Cache-Control', value: 'no-store' }] } } }, position,
    { executeOnce: true });
  const httpOptions = timeout => ({ timeout, redirect: { redirect: { followRedirects: false } },
    response: { response: { fullResponse: true, neverError: true, responseFormat: 'json' } } });
  const nodes = [
    node('Incoming calendar', 'webhook', 2.1, { httpMethod: 'POST', path: CALENDAR_RECEIVER_PATH, authentication: 'headerAuth',
      responseMode: 'responseNode', options: { ignoreBots: false } }, [0, 0], {
      ...(receiverCredential ? { credentials: { httpHeaderAuth: { ...receiverCredential } } } : {}),
      notes: 'AVGAR-only read/draft receiver. Bind a new dedicated Header Auth credential before publishing; never reuse the keyword receiver or Klaviyo credential. No request can authorize a provider read without the fixed Junction authority endpoint.',
    }),
    set('Validate calendar request', 'result', expr(`return api.validateCalendarIncoming($('Incoming calendar').first().json.body, pins, ${clock});`), [260, 0]),
    branch('Request is valid', "={{ $('Validate calendar request').first().json.result.valid === true }}", [520, 0]),
    node('Authorize calendar', 'httpRequest', 4.5, { method: 'POST', url: CALENDAR_AUTHORITY_URL,
      authentication: 'none', sendHeaders: true, headerParameters: { parameters: [
        { name: 'Authorization', value: "={{ 'Bearer ' + $('Incoming calendar').first().json.body.dataToken }}" },
        { name: 'Accept', value: 'application/json' },
      ] }, options: httpOptions(8000) }, [780, -100], { onError: 'continueErrorOutput', retryOnFail: false,
      notes: 'Dynamic run-scoped bearer, not a static provider/root secret. POST to a literal Junction origin with redirects off. This consumes one existing allowance: NEVER retry this request after uncertainty.' }),
    branch('Authority allowed', "={{ $('Authorize calendar').first().json.statusCode === 200 && $('Authorize calendar').first().json.body?.ok === true }}", [1040, -100]),
    set('Canonical calendar context', 'context', expr(`return api.authorizeCalendarReceiver($('Authorize calendar').first().json, $('Incoming calendar').first().json.body, pins, ${clock});`), [1300, -200]),
    node('Read sent campaign pages', 'httpRequest', 4.5, { method: 'GET',
      url: expr(`const context = $('Canonical calendar context').first().json.context;\nif (Date.parse(context.expiresAt) <= Date.parse(${clock})) throw new Error('calendar_authority_expired');\nreturn api.CALENDAR_CAMPAIGN_URL;`),
      authentication: 'genericCredentialType', genericAuthType: 'httpHeaderAuth',
      sendHeaders: true, headerParameters: { parameters: [{ name: 'revision', value: '2026-07-15' }, { name: 'Accept', value: 'application/json' }] },
      options: { ...httpOptions(5000), response: { response: { fullResponse: true, neverError: false, responseFormat: 'json' } }, pagination: { pagination: { paginationMode: 'responseContainsNextURL',
        nextURL: expr(`if (Date.parse($('Canonical calendar context').first().json.context.expiresAt) <= Date.parse(${clock})) throw new Error('calendar_authority_expired');\n// Completion may be checked after URL evaluation: return the fixed base on final null, never follow it.\nreturn api.calendarNextPage($response.body?.links?.next) ?? api.CALENDAR_CAMPAIGN_URL;`),
        paginationCompleteWhen: 'other', completeExpression: '={{ $response.statusCode !== 200 || $response.body?.links?.next === null }}',
        limitPagesFetched: true, maxRequests: 5, requestInterval: 400,
      } } } }, [1560, -200], { credentials: { httpHeaderAuth: { ...CALENDAR_PROVIDER_CREDENTIAL } }, onError: 'continueErrorOutput', retryOnFail: false,
      notes: 'Existing native AVGAR credential, independently bound by account-read execution 85. Sent email metadata only; five-page ceiling, redirects disabled. Incomplete pages are NOT a successful dataset. Header/account and actual pagination behavior still require bounded live acceptance. No sends or profile reads.' }),
    node('Build calendar result', 'code', 2, { mode: 'runOnceForAllItems', language: 'javaScript',
      jsCode: `// Multi-source aggregation only; all provider I/O stays in native HTTP nodes.\nconst api = ${bundle.expression};\nreturn [{ json: api.buildCalendarEnvelope($('Canonical calendar context').first().json.context, $('Read sent campaign pages').all().map(item => item.json), { workflowId: $workflow.id, executionId: String($execution.id) }, $now.toISO()) }];` },
    [1820, -200], { executeOnce: true, onError: 'continueErrorOutput',
      notes: `Exact compiled receiver bundle ${bundle.sha256}. Combines canonical authority, all complete provider pages and actual runtime execution identity. No performance inference from campaign titles. Same-execution coupling is required by Unc independent receipt verification; no child execution or copied implementation.` }),
    respond('Return calendar', 200, "={{ $('Build calendar result').first().json }}", [2080, -200]),
    respond('Return invalid request', 400, "={{ { error: 'validation_error', message: $('Validate calendar request').first().json.result.validationError, details: $('Validate calendar request').first().json.result.details, request_schema: $('Validate calendar request').first().json.result.requiredSchema, executedAction: 'none' } }}", [780, 220]),
    respond('Return authority refusal', "={{ [401,403,404,409,429].includes($('Authorize calendar').first().json.statusCode) ? $('Authorize calendar').first().json.statusCode : 502 }}",
      "={{ { error: 'calendar_authority_refused', message: 'Junction did not authorize this calendar run. Reconcile its saved state before another attempt.', executedAction: 'none' } }}", [1300, 120]),
    respond('Return upstream failure', 502, "={{ { error: 'calendar_upstream_error', message: 'The authorized upstream request failed. Do not blindly retry; reconcile the original execution.', executedAction: 'none' } }}", [1560, 400]),
    respond('Return internal failure', 500, "={{ { error: 'calendar_processing_error', message: 'Calendar validation or result processing failed; no successful artifact is returned.', executedAction: 'none' } }}", [1040, 650]),
  ];
  const connections = {};
  const wire = (from, targets) => { connections[from] = { main: targets.map(name => name ? [{ node: name, type: 'main', index: 0 }] : []) }; };
  wire('Incoming calendar', ['Validate calendar request']);
  wire('Validate calendar request', ['Request is valid', 'Return internal failure']);
  wire('Request is valid', ['Authorize calendar', 'Return invalid request', 'Return internal failure']);
  wire('Authorize calendar', ['Authority allowed', 'Return upstream failure']);
  wire('Authority allowed', ['Canonical calendar context', 'Return authority refusal', 'Return internal failure']);
  wire('Canonical calendar context', ['Read sent campaign pages', 'Return internal failure']);
  wire('Read sent campaign pages', ['Build calendar result', 'Return upstream failure']);
  wire('Build calendar result', ['Return calendar', 'Return internal failure']);
  return { name: CALENDAR_RECEIVER_NAME, nodes, connections, pinData: {}, active: false,
    settings: { executionOrder: 'v1', executionTimeout: 50, saveDataErrorExecution: 'all', saveDataSuccessExecution: 'all',
      saveManualExecutions: true, timezone: 'Etc/UTC' },
    meta: { templateCredsSetupCompleted: !!receiverCredential } };
}
