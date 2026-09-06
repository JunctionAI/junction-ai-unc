# Nguyen: Content search-shadow receivers (D01-W02 / D01-W03)

6 September 2026. Isolated Unc branch work. **Simulated frozen examples only.** No live n8n edit, no credential change, no production SQL, no deploy, no DataForSEO call. Email/Klaviyo stays deferred.

These envelopes are for packaging two **new** Unc receivers. They are not live Unc requests. Historical TEST execution **#68** and keyword schedule execution **#100** are not this contract.

Full JSON pack: `docs/integration/receivers/content-search-shadow.v1/`.

## Published versus proposed

| Status | What | URL / ID |
|---|---|---|
| **Published** | Keyword wrapper. D03-W01 only. Do not send D01 here. | `POST https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow` · workflow `XiXJKuph1fAeH9pe` |
| **Published** | Keyword authority (GET). Do not call from Content. | `GET https://junction-unc.vercel.app/api/n8n/shadow-authority` |
| **Published, not Unc receiver** | Historical combined TEST. Seed was `travel bag`. Kinds `content_hooks` / `content_questions`. Keep #68 untouched. | workflow `lMXjTgd3Qh4vZaMp` rev `c8d6955d-0033-47ce-9672-399f7f10118c` · exec #68 |
| **Published, keyword-only** | Shared saved-schedule path proved automatically. Not a Content run. Do not reuse this schedule row for D01. | schedule `139a41a8-a81c-46dc-850f-1a80a4b9c37a` · command/run `635774fe-c6f0-5738-a826-bff419e474ad` · n8n #100 |
| **Proposed, unpublished** | Viral hooks receiver | `POST https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow` |
| **Proposed, unpublished** | Customer questions receiver | `POST https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow` |
| **Proposed, unpublished** | Content authority (POST, both Content receivers) | `POST https://junction-unc.vercel.app/api/n8n/content-shadow-authority` |

Fixture placeholder wrapper ID `UNPUBLISHED-D01-CONTENT-WRAPPER` / revision `00000000-0000-4000-8000-c0a1e0000001` is **not** a live workflow. After you publish, return the real workflow IDs, frozen revisions, and webhook node IDs. Two separate workflows are expected. Do not reuse `lMXjTgd3Qh4vZaMp` or `XiXJKuph1fAeH9pe`.

Keyword Header Auth credential `Y9Xu3zApLSrcWu1e` must **not** be reused. Create new Header Auth credentials for hooks and questions (name/reference only in the handoff; no secret in chat). Calendar Header Auth `KbxKHh7mfemphL2W` is also separate.

## Do not

- Edit `XiXJKuph1fAeH9pe`, `lMXjTgd3Qh4vZaMp`, calendar draft `rQeWMo5ANO9OtUJp`, or keyword #100 / Content TEST #68.
- Send D01-W02 / D01-W03 to the published keyword-shadow URL.
- Call `GET /api/n8n/shadow-authority` or `POST /api/n8n/calendar-shadow-authority` from Content.
- Trust incoming `dataBaseUrl` as the authority origin. Pin `https://junction-unc.vercel.app`. Redirects disabled.
- Echo `shadow.workflowVersion` on the receipt. Receipt must be `workflowVersion: null`, `revisionEvidence: "pending_unc_verification"`.
- Return packaged kinds `content_hooks` / `content_questions`. Unc kinds are `hook_list` / `question_list`.
- Invent copy on empty SERP. Return `{ needs: [...] }`.
- Mix US/NZ/AU results. Seed is always `golf travel bag` (not `travel bag`).
- Use HTTP 202 / callback for this contract. Respond in 60 seconds.
- Claim views, virality, tickets, frequency, publishing, or executed actions.

## Shared authority (hooks and questions)

Same POST for both receivers. **No request body. No query string.** Run-scoped Bearer `dataToken` from the webhook payload. One-use: a lost 200 fails closed; replay is 409 — do not mint a second DataForSEO call.

```http
POST https://junction-unc.vercel.app/api/n8n/content-shadow-authority
Authorization: Bearer unc_dt.FROZEN_EXAMPLE_NOT_A_LIVE_TOKEN_xxxxxxxxxx
Accept: application/json
```

Redirects: disabled. Origin pin: `https://junction-unc.vercel.app`. Never follow `body.dataBaseUrl`.

After HTTP 200, use **only** `response.shadow.client` (seed, locationCode, languageCode). Ignore any webhook-body override of those fields.

### Authority 200 (US hooks example)

`docs/integration/receivers/content-search-shadow.v1/D01-W02-US.authority-200.json`

```json
{
  "ok": true,
  "shadow": {
    "contract": "unc.content-search-shadow.v1",
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "workflowId": "UNPUBLISHED-D01-CONTENT-WRAPPER",
    "workflowVersion": "00000000-0000-4000-8000-c0a1e0000001",
    "routineId": "D01-W02",
    "routineKey": "viral_hooks",
    "client": {
      "id": "avgar",
      "primaryDomain": "avgarsport.com",
      "seedKeyword": "golf travel bag",
      "locationCode": 2840,
      "languageCode": "en"
    }
  },
  "run": {
    "id": "11111111-1111-4111-8111-00000000d201",
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "routineId": "D01-W02",
    "mode": "dry_run",
    "status": "running",
    "startedAt": "2026-09-06T12:00:00.000Z"
  },
  "authorizedAt": "2026-09-06T12:00:00.400Z",
  "expiresAt": "2026-09-06T12:15:00.000Z",
  "revisionEvidence": "expected_only",
  "executedAction": "none"
}
```

US questions 200 is the same shape with `routineId` `D01-W03`, `routineKey` `customer_questions`, run `11111111-1111-4111-8111-00000000d301`. File: `D01-W03-US.authority-200.json`.

### Authority errors (route-level)

| Case | Status | Body |
|---|---|---|
| GET Content authority | 405 `Allow: POST` | `{ "ok": false, "error": "Content authority requires POST" }` |
| Missing Bearer | 401 | `{ "ok": false, "error": "send the run's data token as Authorization: Bearer <token>" }` |
| Replay of the same token | 409 | `{ "ok": false, "error": "No unused shadow provider allowance; reconcile the existing dispatch" }` |

Full file: `authority.errors.json`. Keyword GET path is `do_not_call`.

## Markets (always separate)

Seed is `golf travel bag` in every file.

| Market | locationCode | Hooks request | Questions request |
|---|---|---|---|
| US | 2840 | `D01-W02-US.request.json` | `D01-W03-US.request.json` |
| NZ | 2554 | `D01-W02-NZ.request.json` | `D01-W03-NZ.request.json` |
| AU | 2036 | `D01-W02-AU.request.json` | `D01-W03-AU.request.json` |

Do not reuse the US SERP for NZ or AU. Language is `en`. Account currency on the webhook is NZD with `budgetMonthly: 0`. `data.scopes` is `[]`.

## D01-W02 viral hooks — proposed unpublished URL

`POST https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow`

- Provider: DataForSEO **SERP organic** (`serp_organic`).
- Unc kind: `hook_list` (not `content_hooks`).
- Max 8 items. Each item `meta.status = "hypothesis"`, `source = "search"`, `views = null`, `measured = false`.
- Evidence must include `dataforseo_serp` ref with seed `golf travel bag` and the contracted location.

### Frozen US request (`D01-W02-US.request.json`)

Inbound Header Auth is a **new unpublished** Content credential, not keyword `Y9Xu3zApLSrcWu1e`. HMAC is Unc signing (`x-unc-timestamp` + `x-unc-signature`).

```json
{
  "class": "simulated_frozen_example",
  "notLiveUncRequest": true,
  "notHistoricalExecution68": true,
  "notKeywordExecution100": true,
  "proposedReceiverUrl": "https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow",
  "publishedKeywordReceiverDoNotUse": "https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow",
  "headers": {
    "content-type": "application/json",
    "authorization": "Bearer <CONTENT_RECEIVER_HEADER_AUTH — unpublished; separate from keyword credential Y9Xu3zApLSrcWu1e>",
    "x-unc-timestamp": "1788696000000",
    "x-unc-signature": "sha256=<HMAC-SHA256(N8N_SIGNING_SECRET, timestamp + '.' + rawBody)>"
  },
  "body": {
    "shadow": {
      "contract": "unc.content-search-shadow.v1",
      "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
      "workflowId": "UNPUBLISHED-D01-CONTENT-WRAPPER",
      "workflowVersion": "00000000-0000-4000-8000-c0a1e0000001",
      "routineId": "D01-W02",
      "routineKey": "viral_hooks",
      "client": {
        "id": "avgar",
        "primaryDomain": "avgarsport.com",
        "seedKeyword": "golf travel bag",
        "locationCode": 2840,
        "languageCode": "en"
      }
    },
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "runId": "11111111-1111-4111-8111-00000000d201",
    "routineId": "D01-W02",
    "skill": "D01-W02",
    "kind": "hook_list",
    "mode": "dry_run",
    "startedAt": "2026-09-06T12:00:00.000Z",
    "account": { "currency": "NZD", "budgetMonthly": 0 },
    "inputs": {},
    "vars": {},
    "reads": {},
    "callback": {
      "path": "/api/routines/artifacts",
      "signatureHeader": "x-unc-signature",
      "timestampHeader": "x-unc-timestamp"
    },
    "dataToken": "unc_dt.FROZEN_EXAMPLE_NOT_A_LIVE_TOKEN_xxxxxxxxxx",
    "dataBaseUrl": "https://junction-unc.vercel.app",
    "data": {
      "scopes": [],
      "expiresAt": "2026-09-06T12:15:00.000Z",
      "endpoints": {
        "reads": "/api/n8n/reads",
        "context": "/api/n8n/context",
        "actions": "/api/n8n/actions"
      }
    }
  }
}
```

### Frozen US response (`D01-W02-US.response.json`)

HTTP 200 body is `{ artifact, executionReceipt }`. `executionId` in a live run is the actual n8n execution number. HTTP 200 from DataForSEO is not success; require top-level and task `20000` plus a real `taskId`.

```json
{
  "artifact": {
    "kind": "hook_list",
    "title": "3 search hook hypotheses for golf travel bag",
    "body": "Hooks are hypothesis reframes of DataForSEO SERP organic titles for seed \"golf travel bag\". Not measured creative performance. SERP snapshots are not GSC clicks or impressions.",
    "items": [
      {
        "title": "Best Golf Travel Bags for US Flights",
        "body": "Hook line: Best Golf Travel Bags for US Flights\nSkeleton: scroll-stopper reframe of a ranking SERP title for \"golf travel bag\"\nMechanic: short-form cut from organic title only\nWhy: ranking #1 organic title (example.com)\nHow to shoot: TBD founder/creator brief — not evidenced\nStatus: hypothesis",
        "meta": {
          "status": "hypothesis",
          "source": "search",
          "mechanic": "serp_title_reframe",
          "domain": "example.com",
          "rank": 1,
          "views": null,
          "measured": false
        }
      }
    ],
    "evidence": [
      {
        "source": "dataforseo_serp",
        "ref": "dataforseo_serp_organic seed=golf travel bag location=2840 fetched_at=2026-09-06T12:00:02.000Z"
      },
      { "source": "search_query", "ref": "golf travel bag" }
    ]
  },
  "executionReceipt": {
    "contract": "unc.content-search-shadow.v1",
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "runId": "11111111-1111-4111-8111-00000000d201",
    "routineId": "D01-W02",
    "routineKey": "viral_hooks",
    "workflowId": "UNPUBLISHED-D01-CONTENT-WRAPPER",
    "workflowVersion": null,
    "revisionEvidence": "pending_unc_verification",
    "executionId": "90021",
    "mode": "dry_run",
    "status": "succeeded",
    "executedAction": "none",
    "startedAt": "2026-09-06T12:00:00.000Z",
    "finishedAt": "2026-09-06T12:00:02.000Z",
    "client": {
      "id": "avgar",
      "primaryDomain": "avgarsport.com",
      "seedKeyword": "golf travel bag",
      "locationCode": 2840,
      "languageCode": "en"
    },
    "provider": {
      "name": "dataforseo",
      "endpoint": "serp_organic",
      "statusCode": 20000,
      "taskStatusCode": 20000,
      "taskId": "frozen-serp-organic-us",
      "itemsCount": 3,
      "fetchedAt": "2026-09-06T12:00:02.000Z",
      "seedKeyword": "golf travel bag",
      "locationCode": 2840,
      "languageCode": "en"
    }
  }
}
```

The disk file has three US organic titles. NZ/AU files use location `2554` / `2036` and NZ/AU titles. Do not copy US titles into those markets.

## D01-W03 customer questions — proposed unpublished URL

`POST https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow`

- Provider: DataForSEO **People Also Ask** (`people_also_ask`).
- Unc kind: `question_list` (not `content_questions`).
- Max 10 items. Each item `meta.frequency = null`, `question_source_type = "search_paa"`, `source = "search"`.
- Evidence must include `dataforseo_serp` ref with seed `golf travel bag` and the contracted location. Not tickets, Gorgias, or reviews.

### Frozen US request (`D01-W03-US.request.json`)

Same envelope as hooks except `routineId` / `skill` `D01-W03`, `routineKey` `customer_questions`, `kind` `question_list`, run `11111111-1111-4111-8111-00000000d301`, proposed URL `.../d01-w03/questions-shadow`.

```json
{
  "class": "simulated_frozen_example",
  "notLiveUncRequest": true,
  "notHistoricalExecution68": true,
  "notKeywordExecution100": true,
  "proposedReceiverUrl": "https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow",
  "publishedKeywordReceiverDoNotUse": "https://junctionai8.app.n8n.cloud/webhook/unc/d03-w01/keyword-shadow",
  "headers": {
    "content-type": "application/json",
    "authorization": "Bearer <CONTENT_RECEIVER_HEADER_AUTH — unpublished; separate from keyword credential Y9Xu3zApLSrcWu1e>",
    "x-unc-timestamp": "1788696000000",
    "x-unc-signature": "sha256=<HMAC-SHA256(N8N_SIGNING_SECRET, timestamp + '.' + rawBody)>"
  },
  "body": {
    "shadow": {
      "contract": "unc.content-search-shadow.v1",
      "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
      "workflowId": "UNPUBLISHED-D01-CONTENT-WRAPPER",
      "workflowVersion": "00000000-0000-4000-8000-c0a1e0000001",
      "routineId": "D01-W03",
      "routineKey": "customer_questions",
      "client": {
        "id": "avgar",
        "primaryDomain": "avgarsport.com",
        "seedKeyword": "golf travel bag",
        "locationCode": 2840,
        "languageCode": "en"
      }
    },
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "runId": "11111111-1111-4111-8111-00000000d301",
    "routineId": "D01-W03",
    "skill": "D01-W03",
    "kind": "question_list",
    "mode": "dry_run",
    "startedAt": "2026-09-06T12:00:00.000Z",
    "account": { "currency": "NZD", "budgetMonthly": 0 },
    "inputs": {},
    "vars": {},
    "reads": {},
    "callback": {
      "path": "/api/routines/artifacts",
      "signatureHeader": "x-unc-signature",
      "timestampHeader": "x-unc-timestamp"
    },
    "dataToken": "unc_dt.FROZEN_EXAMPLE_NOT_A_LIVE_TOKEN_xxxxxxxxxx",
    "dataBaseUrl": "https://junction-unc.vercel.app",
    "data": {
      "scopes": [],
      "expiresAt": "2026-09-06T12:15:00.000Z",
      "endpoints": {
        "reads": "/api/n8n/reads",
        "context": "/api/n8n/context",
        "actions": "/api/n8n/actions"
      }
    }
  }
}
```

### Frozen US response (`D01-W03-US.response.json`)

```json
{
  "artifact": {
    "kind": "question_list",
    "title": "3 search questions for golf travel bag",
    "body": "Questions from DataForSEO People Also Ask for seed \"golf travel bag\". Frequency unmeasured. Search research, not from tickets or support.",
    "items": [
      {
        "title": "What is the best golf travel bag for US flights?",
        "body": "Question: What is the best golf travel bag for US flights?\nContent idea: AVGAR-relevant answer/comparison piece staged from this People Also Ask result only\nFormat: TBD (article/short/FAQ)\nStage: awareness/consideration hypothesis\nFrequency: null (unmeasured)",
        "meta": {
          "frequency": null,
          "question_source_type": "search_paa",
          "source": "search",
          "stage": "hypothesis",
          "rank": 1
        }
      }
    ],
    "evidence": [
      {
        "source": "dataforseo_serp",
        "ref": "dataforseo_serp_people_also_ask seed=golf travel bag location=2840 fetched_at=2026-09-06T12:00:02.000Z"
      },
      { "source": "search_query", "ref": "golf travel bag" }
    ]
  },
  "executionReceipt": {
    "contract": "unc.content-search-shadow.v1",
    "accountId": "aa5cfc84-2569-4c99-9b40-67003ae55eda",
    "runId": "11111111-1111-4111-8111-00000000d301",
    "routineId": "D01-W03",
    "routineKey": "customer_questions",
    "workflowId": "UNPUBLISHED-D01-CONTENT-WRAPPER",
    "workflowVersion": null,
    "revisionEvidence": "pending_unc_verification",
    "executionId": "90031",
    "mode": "dry_run",
    "status": "succeeded",
    "executedAction": "none",
    "startedAt": "2026-09-06T12:00:00.000Z",
    "finishedAt": "2026-09-06T12:00:02.000Z",
    "client": {
      "id": "avgar",
      "primaryDomain": "avgarsport.com",
      "seedKeyword": "golf travel bag",
      "locationCode": 2840,
      "languageCode": "en"
    },
    "provider": {
      "name": "dataforseo",
      "endpoint": "people_also_ask",
      "statusCode": 20000,
      "taskStatusCode": 20000,
      "taskId": "frozen-paa-us",
      "itemsCount": 3,
      "fetchedAt": "2026-09-06T12:00:02.000Z",
      "seedKeyword": "golf travel bag",
      "locationCode": 2840,
      "languageCode": "en"
    }
  }
}
```

The disk file has three US PAA questions. NZ/AU files stay on those locations.

## Empty SERP / PAA (`needs.empty-serp.json`)

Do not invent hooks or questions.

```json
{
  "needs": [
    {
      "input": "search_results",
      "why": "DataForSEO returned zero organic/PAA rows for golf travel bag at this location. Do not invent hooks or questions."
    }
  ]
}
```

## Receiver graph requirements

1. Header Auth on the webhook (new credential per receiver).
2. Validate incoming `shadow` against this contract: account `aa5cfc84-2569-4c99-9b40-67003ae55eda`, seed `golf travel bag`, location one of 2840/2554/2036, `mode: "dry_run"`, matching `routineId` / Unc kind.
3. POST Content authority at the pinned origin with the run `dataToken`. Redirects off. One-use. Do not retry provider after 409.
4. Call DataForSEO only after authority 200, using **canonical** `shadow.client` from that 200.
5. Respond 200 `{ artifact, executionReceipt }` or 200 `{ needs }` within 60s. No 202.
6. Receipt: actual `workflowId` / `executionId`; `workflowVersion: null`; `revisionEvidence: "pending_unc_verification"`; `executedAction: "none"`.
7. Every fallible node has a terminal error response. Provider Retry On Fail off.

## Schedule (Codex-owned later; not a Nguyen loop)

Content will eventually reuse the shared `routine_schedules` path that already fired keyword #100. Customer-selected timezone/hour/weekday/`on_date`, routine-switch checks, claim-per-local-date duplicate protection. **Do not assume Monday 08:00** and do not build a Content-only scheduler or extra combination workflows.

## What to send back after packaging (no live Unc run yet)

- Actual workflow IDs (two), frozen published revisions, webhook node IDs, result-node IDs.
- Proposed URLs confirmed or corrected.
- Header Auth credential **names/references only**.
- Confirmation: keyword wrapper, TEST #68, and calendar draft were not edited.
- Synthetic denial/empty-SERP execution IDs if you test on the watched webhook — not a paid DataForSEO call until Codex issues a bounded Content run.

Unc admission SQL remains on isolated commit `1782d38` and is **not** applied to production. Codex will review that SQL separately. Email stays deferred.
