/** Watched, read-only native HTTP compatibility probe. No Unc authority, result
 * artifact, customer routine, schedule or provider mutation is created here. */
import { buildCalendarReceiverWorkflow } from './calendar-receiver-workflow.mjs';
import { buildCalendarReceiverBundle } from './calendar-receiver-bundle.mjs';
import vm from 'node:vm';

export function buildCalendarCampaignProbe() {
  const bundle = buildCalendarReceiverBundle();
  const api = vm.runInNewContext(bundle.expression, {}, { timeout: 1000 });
  const http = buildCalendarReceiverWorkflow().nodes.find(n => n.name === 'Read sent campaign pages');
  http.id = 'calendar-campaign-probe-http';
  http.name = 'Read AVGAR sent campaign metadata';
  http.position = [260, 0];
  http.parameters.url = api.CALENDAR_CAMPAIGN_URL;
  http.parameters.options.pagination.pagination.nextURL = `={{ (() => { const api = ${bundle.expression}; return api.calendarNextPage($response.body?.links?.next) ?? api.CALENDAR_CAMPAIGN_URL; })() }}`;
  http.onError = 'stopWorkflow';
  http.notes = 'Watched manual compatibility read only. Same reviewed provider request and bounded pagination as the calendar receiver, without an Unc run or synthetic authority. No contacts, sends or mutations. Saved evidence is privileged; do not print raw headers or provider data.';
  const trigger = { id: 'calendar-campaign-probe-trigger', name: 'Start watched campaign read', type: 'n8n-nodes-base.manualTrigger',
    typeVersion: 1, position: [0, 0], parameters: {} };
  return { name: 'CODEX — AVGAR — Verify campaign metadata read', nodes: [trigger, http],
    connections: { [trigger.name]: { main: [[{ node: http.name, type: 'main', index: 0 }]] } },
    active: false, pinData: {}, settings: { executionOrder: 'v1', executionTimeout: 40,
      saveManualExecutions: true, saveDataSuccessExecution: 'all', saveDataErrorExecution: 'all', timezone: 'Etc/UTC' } };
}
