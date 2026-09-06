import { AVGAR_PILOT_ACCOUNT } from "../shadowContract";
import { CONTENT_HOOKS_RECEIVER_URL, CONTENT_QUESTIONS_RECEIVER_URL, CONTENT_ROUTINES, CONTENT_SEED,
  type ContentShadowContract } from "../contentShadowContract";
import type { ArtifactDraft, RunContext } from "../../runtime/types";
import { N8N_EXECUTION_API_BASE } from "../../../worker/providers/n8nExecutionReader";

export const start = "2026-09-06T12:00:00.000Z", end = "2026-09-06T12:00:02.000Z";
export const now = () => new Date("2026-09-06T12:00:03.000Z");
export function hooksContract(over: Partial<ContentShadowContract> = {}): ContentShadowContract {
  return { contract: "unc.content-search-shadow.v1", accountId: AVGAR_PILOT_ACCOUNT,
    workflowId: "synthetic-content", workflowVersion: "00000000-0000-4000-8000-000000000002",
    routineId: "D01-W02", routineKey: "viral_hooks",
    client: { id: "avgar", primaryDomain: "avgarsport.com", seedKeyword: CONTENT_SEED, locationCode: 2840, languageCode: "en" },
    ...over };
}
export const contract = hooksContract();
export const questionsContract = hooksContract({ routineId: "D01-W03", routineKey: "customer_questions" });
export const account = { accountId: contract.accountId, contextGeneration: 1, currency: "NZD", budgetMonthly: 0 };
export function ctxFor(c: ContentShadowContract): RunContext {
  return { account, runId: "00000000-0000-4000-8000-000000000004", routineId: c.routineId, version: 2,
    startedAt: start, mode: "dry_run", caps: { currency: "NZD", perDay: 0, perMonth: 0 }, triggeredBy: "manual", vars: {}, inputs: {}, reads: {}, checks: {} };
}
export const ctx = ctxFor(contract);
export const env = {
  NODE_ENV: "production", N8N_SIGNING_SECRET: "synthetic-signing-root-content",
  N8N_CONTENT_HOOKS_SHADOW_RECEIVER_URL: CONTENT_HOOKS_RECEIVER_URL,
  N8N_CONTENT_HOOKS_SHADOW_RECEIVER_TOKEN: "synthetic-content-hooks-receiver-credential",
  N8N_CONTENT_QUESTIONS_SHADOW_RECEIVER_URL: CONTENT_QUESTIONS_RECEIVER_URL,
  N8N_CONTENT_QUESTIONS_SHADOW_RECEIVER_TOKEN: "synthetic-content-questions-receiver-token",
  N8N_SHADOW_RECEIVER_TOKEN: "synthetic-other-keyword-receiver-credential",
  N8N_CONTENT_SHADOW_WORKFLOW_ID: contract.workflowId, N8N_CONTENT_SHADOW_TRIGGER_NODE_ID: "incoming-content",
  N8N_CONTENT_SHADOW_RESULT_NODE_ID: "result-content",
  N8N_EXECUTION_READER_ENABLED: "true", N8N_EXECUTION_API_BASE_URL: N8N_EXECUTION_API_BASE,
  N8N_EXECUTION_API_KEY: "synthetic-independent-content-execution-key", N8N_DATA_BASE_URL: "https://unc.example.com",
};
export const registration = { id: "00000000-0000-4000-8000-000000000005", accountId: account.accountId,
  routineId: "D01-W02", active: true, webhookUrl: CONTENT_HOOKS_RECEIVER_URL };
export function hooksArtifact(): ArtifactDraft {
  return { kind: "hook_list", title: "3 search hook hypotheses for golf travel bag",
    body: "Hooks are hypothesis reframes of DataForSEO SERP organic titles for seed \"golf travel bag\". Not measured creative performance.",
    items: [
      { title: "Best golf travel bags", body: "Hook line from SERP #1. Status: hypothesis", meta: { status: "hypothesis", source: "search", rank: 1, domain: "example.com", views: null, measured: false } },
      { title: "How to pack a golf travel bag", body: "Hook line from SERP #2. Status: hypothesis", meta: { status: "hypothesis", source: "search", rank: 2, views: null, measured: false } },
      { title: "UFORIA travel case vs generic", body: "Hook line from SERP #3. Status: hypothesis", meta: { status: "hypothesis", source: "search", rank: 3, views: null, measured: false } },
    ],
    evidence: [{ source: "dataforseo_serp", ref: `dataforseo_serp_organic seed=${CONTENT_SEED} location=2840 fetched_at=${end}` },
      { source: "search_query", ref: CONTENT_SEED }] };
}
export function questionsArtifact(): ArtifactDraft {
  return { kind: "question_list", title: "3 search questions for golf travel bag",
    body: "Questions from DataForSEO People Also Ask for seed \"golf travel bag\". Frequency unmeasured. Search research, not first-party customer tickets.",
    items: [
      { title: "What is the best golf travel bag?", body: "Question from PAA. Frequency: null", meta: { frequency: null, question_source_type: "search_paa", source: "search", rank: 1 } },
      { title: "Can I take a golf bag on a plane?", body: "Question from PAA. Frequency: null", meta: { frequency: null, question_source_type: "search_paa", source: "search", rank: 2 } },
      { title: "How to choose a golf travel case?", body: "Question from PAA. Frequency: null", meta: { frequency: null, question_source_type: "search_paa", source: "search", rank: 3 } },
    ],
    evidence: [{ source: "dataforseo_serp", ref: `dataforseo_serp_people_also_ask seed=${CONTENT_SEED} location=2840 fetched_at=${end}` },
      { source: "search_query", ref: CONTENT_SEED }] };
}
export function receipt(c: ContentShadowContract = contract, run = ctxFor(c)): Record<string, unknown> {
  return { contract: c.contract, accountId: c.accountId, runId: run.runId, routineId: c.routineId, routineKey: c.routineKey,
    workflowId: c.workflowId, workflowVersion: null, revisionEvidence: "pending_unc_verification", executionId: "12345",
    startedAt: run.startedAt, finishedAt: end, mode: "dry_run", status: "succeeded", executedAction: "none", client: { ...c.client },
    provider: { name: "dataforseo", endpoint: CONTENT_ROUTINES[c.routineId].endpoint, statusCode: 20000, taskStatusCode: 20000,
      taskId: "synthetic-task", itemsCount: 3, fetchedAt: end, seedKeyword: c.client.seedKeyword,
      locationCode: c.client.locationCode, languageCode: "en" } };
}
export function savedExecution(body: unknown, reply: unknown, c: ContentShadowContract = contract) {
  return { id: "12345", workflowId: c.workflowId, workflowVersionId: c.workflowVersion,
    status: "success", finished: true, mode: "webhook", startedAt: start, stoppedAt: end,
    workflowData: { id: c.workflowId, versionId: c.workflowVersion, nodes: [
      { id: "incoming-content", name: "Incoming", type: "n8n-nodes-base.webhook" },
      { id: "result-content", name: "Result", type: "n8n-nodes-base.code" },
    ] }, data: { resultData: { runData: {
      Incoming: [{ executionStatus: "success", data: { main: [[{ json: { body, headers: { authorization: "never-export" } } }]] } }],
      Result: [{ executionStatus: "success", data: { main: [[{ json: reply }]] } }],
    } } } };
}
export const dns = async () => [{ address: "93.184.216.34", family: 4 }];
