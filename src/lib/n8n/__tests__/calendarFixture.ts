import type { CalendarShadowContract } from "../calendarShadowContract";
import type { ArtifactDraft, RunContext } from "../../runtime/types";
import { CALENDAR_SHADOW_RECEIVER_URL } from "../calendarShadowContract";
import { N8N_EXECUTION_API_BASE } from "../../../worker/providers/n8nExecutionReader";

// Entirely synthetic identities/credentials and data; never call a live provider.
export const start = "2026-09-06T12:00:00.000Z", end = "2026-09-06T12:00:02.000Z";
export const now = () => new Date("2026-09-06T12:00:03.000Z");
export const contract: CalendarShadowContract = { contract: "unc.campaign-calendar-shadow.v1",
  accountId: "00000000-0000-4000-8000-000000000001", workflowId: "synthetic-calendar",
  workflowVersion: "00000000-0000-4000-8000-000000000002", routineId: "D05-W07", routineKey: "campaign_calendar",
  client: { primaryDomain: "example.com", timezone: "Pacific/Auckland", currency: "NZD",
    bindingId: "00000000-0000-4000-8000-000000000003", klaviyoAccountId: "synthetic-klaviyo-account" },
  data: { mode: "provider", queryHash: "a".repeat(64) } };
export const account = { accountId: contract.accountId, contextGeneration: 2, currency: "NZD", budgetMonthly: 0 };
export const ctx: RunContext = { account, runId: "00000000-0000-4000-8000-000000000004", routineId: "D05-W07", version: 2,
  startedAt: start, mode: "dry_run", caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} };
export const env = { NODE_ENV: "production", N8N_SIGNING_SECRET: "synthetic-signing-root-calendar",
  N8N_CALENDAR_SHADOW_RECEIVER_URL: CALENDAR_SHADOW_RECEIVER_URL,
  N8N_CALENDAR_SHADOW_RECEIVER_TOKEN: "synthetic-calendar-receiver-credential",
  N8N_SHADOW_RECEIVER_TOKEN: "synthetic-other-keyword-receiver-credential",
  N8N_CALENDAR_SHADOW_WORKFLOW_ID: contract.workflowId, N8N_CALENDAR_SHADOW_TRIGGER_NODE_ID: "incoming-calendar",
  N8N_CALENDAR_SHADOW_RESULT_NODE_ID: "result-calendar",
  N8N_EXECUTION_READER_ENABLED: "true", N8N_EXECUTION_API_BASE_URL: N8N_EXECUTION_API_BASE,
  N8N_EXECUTION_API_KEY: "synthetic-independent-calendar-execution-key", N8N_DATA_BASE_URL: "https://unc.example.com" };
export const registration = { id: "00000000-0000-4000-8000-000000000005", accountId: account.accountId,
  routineId: "D05-W07", active: true, webhookUrl: CALENDAR_SHADOW_RECEIVER_URL };
export function artifact(): ArtifactDraft {
  const weeks = ["2026-09-14", "2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19"];
  return { kind: "calendar", title: "Six proposed campaign weeks", body: "A synthetic proposal based on campaign metadata. Timing is a hypothesis, not proven performance.",
    items: weeks.map(week => ({ title: `${week}: Product education`, body: "An email explaining product care. Subject: looking after your equipment. Proposed timing needs review.",
      meta: { week_start: week, channel: "email", theme: "Product education", timing_basis: "hypothesis" } })),
    meta: { private_unused_root: "do not retain" }, evidence: [] };
}
export function receipt(c = contract, run = ctx): Record<string, unknown> {
  return { contract: c.contract, accountId: c.accountId, runId: run.runId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: null, revisionEvidence: "pending_unc_verification", executionId: "12345",
    startedAt: run.startedAt, finishedAt: end, mode: "dry_run", status: "succeeded", executedAction: "none", client: { ...c.client },
    provider: { name: "klaviyo", dataset: "campaign_metadata", accountId: c.client.klaviyoAccountId, bindingId: c.client.bindingId,
      queryHash: c.data.queryHash, source: c.data.mode, complete: true, itemsCount: 0,
      ...(c.data.mode === "provider" ? { fetchedAt: end, statusCode: 200 } : { fetchedAt: c.data.fetchedAt, snapshotId: c.data.snapshotId }) } };
}
export function savedExecution(body: unknown, reply: unknown) {
  return { id: "12345", workflowId: contract.workflowId, workflowVersionId: contract.workflowVersion,
    status: "success", finished: true, mode: "webhook", startedAt: start, stoppedAt: end,
    workflowData: { id: contract.workflowId, versionId: contract.workflowVersion, nodes: [
      { id: "incoming-calendar", name: "Incoming", type: "n8n-nodes-base.webhook" },
      { id: "result-calendar", name: "Result", type: "n8n-nodes-base.code" },
    ] }, data: { resultData: { runData: {
      Incoming: [{ executionStatus: "success", data: { main: [[{ json: { body, headers: { authorization: "never-export" } } }]] } }],
      Result: [{ executionStatus: "success", data: { main: [[{ json: reply }]] } }],
    } } } };
}
export const dns = async () => [{ address: "93.184.216.34", family: 4 }];
