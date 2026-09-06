/** Frozen Content receiver examples. Simulated envelopes for Nguyen packaging.
 * Not live Unc requests, not n8n execution #68 or keyword execution #100. */
import { AVGAR_PILOT_ACCOUNT } from "./shadowContract";
import { CONTENT_HOOKS_RECEIVER_URL, CONTENT_MARKETS, CONTENT_QUESTIONS_RECEIVER_URL, CONTENT_ROUTINES,
  CONTENT_SEED, CONTENT_SHADOW_CONTRACT, type ContentRoutineId, type ContentShadowContract } from "./contentShadowContract";
import { buildHooksArtifact, buildQuestionsArtifact } from "./contentReceiver";

export const CONTENT_RECEIVER_STATUS = {
  keywordWrapper: { status: "published", workflowId: "XiXJKuph1fAeH9pe",
    receiverUrl: "https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow",
    authority: "GET https://junction-unc.vercel.app/api/n8n/shadow-authority",
    note: "D03-W01 only. Do not send D01-W02/D01-W03 here. Live keyword schedule used execution #100." },
  historicalContentTest: { status: "published_not_unc_receiver", workflowId: "lMXjTgd3Qh4vZaMp",
    revision: "c8d6955d-0033-47ce-9672-399f7f10118c", execution: "68",
    note: "Combined TEST workflow; seed was travel bag; kinds content_hooks/content_questions. Not this contract." },
  keywordScheduleProof: {
    status: "published_keyword_only",
    scheduleId: "139a41a8-a81c-46dc-850f-1a80a4b9c37a",
    commandRunId: "635774fe-c6f0-5738-a826-bff419e474ad",
    n8nExecution: "100",
    note: "Shared saved-schedule path proved on D03-W01. Not a Content run. Do not reuse this schedule row for D01.",
  },
  hooksReceiver: { status: "proposed_unpublished", url: CONTENT_HOOKS_RECEIVER_URL,
    authority: "POST https://junction-unc.vercel.app/api/n8n/content-shadow-authority" },
  questionsReceiver: { status: "proposed_unpublished", url: CONTENT_QUESTIONS_RECEIVER_URL,
    authority: "POST https://junction-unc.vercel.app/api/n8n/content-shadow-authority" },
  wrapperId: "UNPUBLISHED-D01-CONTENT-WRAPPER",
  wrapperRevision: "00000000-0000-4000-8000-c0a1e0000001",
  keywordHeaderAuthDoNotReuse: "Y9Xu3zApLSrcWu1e",
} as const;

export const FROZEN_CLOCK = {
  startedAt: "2026-09-06T12:00:00.000Z",
  finishedAt: "2026-09-06T12:00:02.000Z",
  fetchedAt: "2026-09-06T12:00:02.000Z",
  authorizedAt: "2026-09-06T12:00:00.400Z",
  expiresAt: "2026-09-06T12:15:00.000Z",
} as const;

const DATA_TOKEN = "unc_dt.FROZEN_EXAMPLE_NOT_A_LIVE_TOKEN_xxxxxxxxxx";
const RUNS: Record<ContentRoutineId, Record<keyof typeof CONTENT_MARKETS, string>> = {
  "D01-W02": { US: "11111111-1111-4111-8111-00000000d201", NZ: "11111111-1111-4111-8111-00000000d202", AU: "11111111-1111-4111-8111-00000000d203" },
  "D01-W03": { US: "11111111-1111-4111-8111-00000000d301", NZ: "11111111-1111-4111-8111-00000000d302", AU: "11111111-1111-4111-8111-00000000d303" },
};
const EXECUTIONS: Record<ContentRoutineId, Record<keyof typeof CONTENT_MARKETS, string>> = {
  "D01-W02": { US: "90021", NZ: "90022", AU: "90023" },
  "D01-W03": { US: "90031", NZ: "90032", AU: "90033" },
};
const TASKS: Record<ContentRoutineId, Record<keyof typeof CONTENT_MARKETS, string>> = {
  "D01-W02": { US: "frozen-serp-organic-us", NZ: "frozen-serp-organic-nz", AU: "frozen-serp-organic-au" },
  "D01-W03": { US: "frozen-paa-us", NZ: "frozen-paa-nz", AU: "frozen-paa-au" },
};

const ORGANIC: Record<keyof typeof CONTENT_MARKETS, { rank: number; title: string; url: string; domain: string }[]> = {
  US: [
    { rank: 1, title: "Best Golf Travel Bags for US Flights", url: "https://example.com/us/golf-travel-bags", domain: "example.com" },
    { rank: 2, title: "How to Pack a Golf Travel Bag", url: "https://example.com/us/pack-golf-bag", domain: "example.com" },
    { rank: 3, title: "Hard Case vs Soft Golf Travel Bag", url: "https://example.com/us/hard-vs-soft", domain: "example.com" },
  ],
  NZ: [
    { rank: 1, title: "Best golf travel bags in New Zealand", url: "https://example.com/nz/golf-travel-bags", domain: "example.com" },
    { rank: 2, title: "Taking a golf bag on a domestic NZ flight", url: "https://example.com/nz/domestic-golf-bag", domain: "example.com" },
  ],
  AU: [
    { rank: 1, title: "Best golf travel bags Australia", url: "https://example.com/au/golf-travel-bags", domain: "example.com" },
    { rank: 2, title: "Cabin vs checked golf travel bags for Australian flights", url: "https://example.com/au/cabin-vs-checked", domain: "example.com" },
  ],
};
const PAA: Record<keyof typeof CONTENT_MARKETS, { rank: number; question: string }[]> = {
  US: [
    { rank: 1, question: "What is the best golf travel bag for US flights?" },
    { rank: 2, question: "Can I take a golf travel bag as checked luggage in the US?" },
    { rank: 3, question: "How do I choose a hard golf travel case?" },
  ],
  NZ: [
    { rank: 1, question: "What is the best golf travel bag in New Zealand?" },
    { rank: 2, question: "Can I take a golf bag on a domestic NZ flight?" },
  ],
  AU: [
    { rank: 1, question: "What is the best golf travel bag in Australia?" },
    { rank: 2, question: "Do Australian airlines allow golf travel bags as checked luggage?" },
  ],
};

export function frozenContract(routineId: ContentRoutineId, market: keyof typeof CONTENT_MARKETS): ContentShadowContract {
  const lane = CONTENT_ROUTINES[routineId];
  return {
    contract: CONTENT_SHADOW_CONTRACT, accountId: AVGAR_PILOT_ACCOUNT,
    workflowId: CONTENT_RECEIVER_STATUS.wrapperId, workflowVersion: CONTENT_RECEIVER_STATUS.wrapperRevision,
    routineId, routineKey: lane.routineKey,
    client: { id: "avgar", primaryDomain: "avgarsport.com", seedKeyword: CONTENT_SEED,
      locationCode: CONTENT_MARKETS[market], languageCode: "en" },
  };
}

export function frozenRequest(routineId: ContentRoutineId, market: keyof typeof CONTENT_MARKETS) {
  const lane = CONTENT_ROUTINES[routineId];
  const contract = frozenContract(routineId, market);
  const runId = RUNS[routineId][market];
  return {
    class: "simulated_frozen_example",
    notLiveUncRequest: true,
    notHistoricalExecution68: true,
    notKeywordExecution100: true,
    proposedReceiverUrl: lane.receiverUrl,
    publishedKeywordReceiverDoNotUse: CONTENT_RECEIVER_STATUS.keywordWrapper.receiverUrl,
    headers: {
      "content-type": "application/json",
      authorization: "Bearer <CONTENT_RECEIVER_HEADER_AUTH — unpublished; separate from keyword credential Y9Xu3zApLSrcWu1e>",
      "x-unc-timestamp": "1788696000000",
      "x-unc-signature": "sha256=<HMAC-SHA256(N8N_SIGNING_SECRET, timestamp + '.' + rawBody)>",
    },
    body: {
      shadow: contract,
      accountId: AVGAR_PILOT_ACCOUNT, runId, routineId, skill: routineId, kind: lane.kind,
      mode: "dry_run", startedAt: FROZEN_CLOCK.startedAt,
      account: { currency: "NZD", budgetMonthly: 0 }, inputs: {}, vars: {}, reads: {},
      callback: { path: "/api/routines/artifacts", signatureHeader: "x-unc-signature", timestampHeader: "x-unc-timestamp" },
      dataToken: DATA_TOKEN, dataBaseUrl: "https://junction-unc.vercel.app",
      data: { scopes: [], expiresAt: FROZEN_CLOCK.expiresAt,
        endpoints: { reads: "/api/n8n/reads", context: "/api/n8n/context", actions: "/api/n8n/actions" } },
    },
  };
}

/** Exact HTTP call Unc's Content authority expects. Same for hooks and questions. No body. */
export function frozenAuthorityHttp() {
  return {
    class: "simulated_frozen_example",
    method: "POST",
    url: "https://junction-unc.vercel.app/api/n8n/content-shadow-authority",
    body: null,
    query: null,
    headers: { authorization: `Bearer ${DATA_TOKEN}`, accept: "application/json" },
    redirects: "disabled",
    originPin: "https://junction-unc.vercel.app",
    neverUseIncomingDataBaseUrl: true,
    tokenUse: "one-use; replay is 409; lost response fails closed — do not mint a second provider call",
    timeoutMs: 60_000,
    doNotCall: [
      "GET https://junction-unc.vercel.app/api/n8n/shadow-authority",
      "POST https://junction-unc.vercel.app/api/n8n/calendar-shadow-authority",
    ],
    note: "Same POST for D01-W02 and D01-W03. The Bearer dataToken is run-scoped; do not send D01 IDs on the keyword GET path.",
  };
}

export function frozenAuthorityErrors() {
  return {
    class: "simulated_frozen_example",
    get: {
      method: "GET",
      url: "https://junction-unc.vercel.app/api/n8n/content-shadow-authority",
      status: 405,
      headers: { allow: "POST", "cache-control": "no-store", vary: "Authorization" },
      body: { ok: false, error: "Content authority requires POST" },
    },
    missingToken: {
      method: "POST",
      url: "https://junction-unc.vercel.app/api/n8n/content-shadow-authority",
      status: 401,
      body: { ok: false, error: "send the run's data token as Authorization: Bearer <token>" },
    },
    replay: {
      method: "POST",
      url: "https://junction-unc.vercel.app/api/n8n/content-shadow-authority",
      status: 409,
      body: { ok: false, error: "No unused shadow provider allowance; reconcile the existing dispatch" },
    },
    keywordPath: {
      method: "GET",
      url: "https://junction-unc.vercel.app/api/n8n/shadow-authority",
      status: "do_not_call",
      note: "Keyword-only GET. A Content dataToken here is protocol mismatch. Do not use for D01-W02/D01-W03.",
    },
  };
}

export function frozenAuthoritySuccess(routineId: ContentRoutineId, market: keyof typeof CONTENT_MARKETS) {
  const contract = frozenContract(routineId, market);
  return {
    class: "simulated_frozen_example",
    method: "POST",
    url: "https://junction-unc.vercel.app/api/n8n/content-shadow-authority",
    doNotCall: "https://junction-unc.vercel.app/api/n8n/shadow-authority",
    requestHeaders: { authorization: `Bearer ${DATA_TOKEN}`, accept: "application/json" },
    redirects: "disabled",
    origin: "https://junction-unc.vercel.app",
    neverUseIncomingDataBaseUrl: true,
    response: {
      ok: true, shadow: contract,
      run: { id: RUNS[routineId][market], accountId: AVGAR_PILOT_ACCOUNT, routineId, mode: "dry_run",
        status: "running", startedAt: FROZEN_CLOCK.startedAt },
      authorizedAt: FROZEN_CLOCK.authorizedAt, expiresAt: FROZEN_CLOCK.expiresAt,
      revisionEvidence: "expected_only", executedAction: "none",
    },
  };
}

export function frozenResponse(routineId: ContentRoutineId, market: keyof typeof CONTENT_MARKETS) {
  const contract = frozenContract(routineId, market);
  const artifact = routineId === "D01-W02"
    ? buildHooksArtifact(ORGANIC[market], contract, FROZEN_CLOCK.fetchedAt)
    : buildQuestionsArtifact(PAA[market], contract, FROZEN_CLOCK.fetchedAt);
  return {
    class: "simulated_frozen_example",
    notLiveProviderResult: true,
    artifact,
    executionReceipt: {
      contract: contract.contract, accountId: contract.accountId, runId: RUNS[routineId][market],
      routineId: contract.routineId, routineKey: contract.routineKey, workflowId: contract.workflowId,
      workflowVersion: null, revisionEvidence: "pending_unc_verification",
      executionId: EXECUTIONS[routineId][market], mode: "dry_run", status: "succeeded", executedAction: "none",
      startedAt: FROZEN_CLOCK.startedAt, finishedAt: FROZEN_CLOCK.finishedAt, client: { ...contract.client },
      provider: {
        name: "dataforseo", endpoint: CONTENT_ROUTINES[routineId].endpoint, statusCode: 20000, taskStatusCode: 20000,
        taskId: TASKS[routineId][market], itemsCount: artifact.items!.length, fetchedAt: FROZEN_CLOCK.fetchedAt,
        seedKeyword: CONTENT_SEED, locationCode: CONTENT_MARKETS[market], languageCode: "en",
      },
    },
  };
}

export function frozenNeedsEmpty() {
  return { class: "simulated_frozen_example", needs: [{ input: "search_results",
    why: "DataForSEO returned zero organic/PAA rows for golf travel bag at this location. Do not invent hooks or questions." }] };
}

export const CONTENT_MARKETS_LIST = ["US", "NZ", "AU"] as const;
export const CONTENT_ROUTINE_LIST = ["D01-W02", "D01-W03"] as const;
