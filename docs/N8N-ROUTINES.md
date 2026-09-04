# n8n as Unc's skills

A routine's **produce** step can be served by one of Tom's (or the founder's) n8n workflows
instead of the built-in `LlmProducer`. Register a webhook per routine; the engine POSTs the
run's material to it, signed, and stores whatever Artifact comes back exactly as it would a
producer's — same receipt, same gate, same "What I drafted" card. Nothing outward ever happens
from n8n's answer: it is a draft. If the workflow cannot answer (unreachable, timeout, a rejected
artifact) the engine writes a receipt saying so and **drafts with the built-in skill instead**.

**v2 (2026-09-03): seamless auth.** The founder authenticates ONCE, in Junction. A workflow never
holds a platform credential: every run carries a short-lived, run-scoped **data token**, and the
workflow reads the founder's data through `/api/n8n/reads` — the same reader, the same sealed
credential, a `read` receipt on the run. `/api/n8n/context` hands it the same material the
built-in skill drafts from. `/api/n8n/actions` accepts a proposed mutation and **records it for
approval; nothing executes until wave 2**.

## Register a workflow

**In the app** — sidebar → **Skills** (accounts mode, owner). Paste the webhook URL next to the
routine, **Test** it (a signed fixture payload; you see the artifact or the error), activate or
pause. An admin (`UNC_ADMIN_EMAILS`) can tick "every account" to register a global workflow and
sees every account's model spend for the month.

**API** — `GET/POST/PATCH /api/skills/n8n` (session-bound):

```
GET                                       → { routines: [{ routineId, name, category, wave, builtIn, produces, source: "n8n"|"builtin"|"none", workflow, workflows }], owner, admin, secretConfigured, dataBaseUrl, budget }
POST  { routineId, webhookUrl, global? }  → { workflow }      one row per (scope, routine); re-registering replaces + re-activates
PATCH { id, active?, webhookUrl? }        → { workflow }      pause / resume / change
POST  /api/skills/n8n/test { routineId, webhookUrl } → { ok, kind: "artifact"|"needs"|"accepted", … } | { ok: false, error }
```

**SQL** (service role) still works:

```sql
insert into n8n_workflows (routine_id, webhook_url) values ('D01-W01', 'https://n8n.example/webhook/founder-posts');           -- global
insert into n8n_workflows (account_id, routine_id, webhook_url) values ('<account uuid>', 'D03-W01', 'https://n8n.example/webhook/keywords-acme');  -- one account (wins)
update n8n_workflows set active = false where id = '<id>';
```

Precedence: the account's active row, then a global active row, then the built-in skill. A spec
can also carry an explicit `n8n` node with `webhookUrl` / `webhookUrlEnv` and `timeoutMs`; an
explicit node never falls back.

### Environment

| Variable | Where | What |
|---|---|---|
| `N8N_SIGNING_SECRET` | Junction app + worker **server-side only** | **required** — signs bridge requests and run-scoped data tokens. Never copy it into customer/client n8n, a workflow, browser, or exported JSON. External workflows receive signed requests and opaque tokens; they never mint either. `openssl rand -hex 32`. |
| `N8N_DATA_BASE_URL` | app + worker | optional — the base URL workflows call for data (`dataBaseUrl` in the payload). Defaults to `APP_URL` / `NEXT_PUBLIC_APP_URL`. |
| `UNC_ADMIN_EMAILS` | app | comma list of admin sign-ins (global workflows, the spend view). |
| `N8N_ALLOW_HTTP` | app/worker | `1` allows plain HTTP only when `NODE_ENV=development`; production ignores it. |
| `N8N_ALLOW_PRIVATE_DEV` | app/worker | `1` allows localhost/private webhook targets only when `NODE_ENV=development`; production ignores it. Tests are separately bounded by `NODE_ENV=test`. |

Registration rejects credentials in URLs and production localhost/private/link-local targets. The
worker repeats the check immediately before every request, resolves the hostname, rejects a target
when any DNS answer is non-public, pins the approved IP into the socket while preserving HTTPS
Host/SNI verification, sends with `redirect: "manual"`, fails on every redirect, and rejects a
response body above 1 MiB.
If an older template put `N8N_SIGNING_SECRET` in n8n, remove it there and rotate the Junction-side
secret before enabling the proxy; treat the old value as exposed.

## The contract

### Request (Unc → n8n)

`POST <webhook_url>` · `content-type: application/json`
`x-unc-timestamp: <ms since epoch>` · `x-unc-signature: sha256=<server-generated HMAC>`

The HMAC secret stays inside Junction. A customer-owned workflow treats `dataToken` as opaque and
uses it only as the Bearer token shown below. Do not recreate, decode-and-edit, or re-sign it. Keep
the long random n8n production webhook URL private: in this version that capability URL is the
customer workflow's receiver-side boundary.

```json
{
  "accountId": "…", "runId": "…", "routineId": "D01-W01", "skill": "D01-W01", "kind": "post_set",
  "mode": "dry_run", "startedAt": "2026-09-03T07:00:00.000Z",
  "account": { "currency": "NZD", "budgetMonthly": 3000 },
  "inputs": { "about_the_business": "…" },
  "vars": { "website": "acme.test" },
  "reads": { "questions": { "count": 12, "provenance": "ok", "metrics": {}, "sample": [ … ≤ 8 rows … ] } },
  "callback": { "path": "/api/routines/artifacts", "signatureHeader": "x-unc-signature", "timestampHeader": "x-unc-timestamp" },
  "dataToken": "unc_dt.<claims>.<mac>",
  "dataBaseUrl": "https://unc.getjunction.ai",
  "data": { "scopes": ["gorgias:tickets", "linkedin:posts", "shopify:products"], "expiresAt": "2026-09-03T07:15:00.000Z",
            "endpoints": { "reads": "/api/n8n/reads", "context": "/api/n8n/context", "actions": "/api/n8n/actions" } }
}
```

`reads` are the run's platform reads compacted to ~7 KB (`provenance: "unavailable"` = couldn't
ask). `kind` is the artifact kind the skill expects.

### The data token (seamless auth)

`dataToken` is an opaque `unc_dt.…` bearer token minted only by Junction. Internally it carries
`{ v, accountId, runId, routineId, scopes, iat, exp }`, but workflows must not mint or modify it:

- **15-minute expiry**, bound to **one persisted run**; the proxy answers only while that run is
  `running` (`409` once it finished). It loads the stored run and independently requires the
  token's account and routine to match. There is no `test:` bypass: the Skills test creates a real
  persisted dry-run and its reads leave normal receipts.
- **Scopes** are recomputed from that run's stored routine spec as the exact
  `platform:resource` pair for every declared read node. Skill minimums describe usefulness but
  grant no data-plane authority; required/helpful platform names never become wildcards. A
  founder-content token cannot read Meta insights (`403`), and a token is rejected if any requested
  scope exceeds that server-derived allowlist.
- Send it as `Authorization: Bearer <dataToken>`. **60 calls a minute** per token (`429`).
- The workflow never sees a credential: the proxy opens the sealed connector secret server-side
  (`ConnectorCredentialProvider`) and runs the worker's own reader.

#### `GET /api/n8n/reads?platform=&resource=&window=&limit=&fields=<json>&filter=<json>`

```
200 { "ok": true, "rows": [...], "count": 12, "metrics": {...},
      "provenance": { "platform": "shopify", "resource": "products", "window": null, "fetchedAt": "…", "source": "ok"|"empty"|"fixture", "via": "n8n", "receiptId": "…" } }
200 { "ok": false, "code": "not_connected" | "secret_store_unavailable" | "platform_error", "reason": "shopify is not connected for this account" }
400 bad query · 401 bad / expired token · 403 out of scope · 404 no run for the token · 409 run closed · 429 · 503 no secret
```

`ok:false` is an honest **"couldn't ask"** — never "nothing happened". Every answered read lands a
`read` receipt on the run ("Read shopify products via n8n: 12 rows."); every refusal a
notification receipt. Resources are the platform nouns the readers know (shopify: orders ·
products · customers · checkouts · pages; klaviyo: flows · campaigns · segments · metrics; ga4:
report; meta_ads: insights · campaigns · ads; google_ads; hubspot). `fields` / `filter` are the
runtime `ReadQuery` fields as JSON.

#### `GET /api/n8n/context`

The compact account context the built-in `LlmProducer` drafts from:

```json
{ "ok": true,
  "routine": { "id": "D01-W01", "name": "Founder content engine", "kind": "post_set", "maxItems": 3, "purpose": "…", "domain": "content",
               "minimum": { "summary": "…", "platforms": [], "inputs": ["about_the_business"], "helpful": ["gorgias","linkedin","shopify"] },
               "inputs": ["…"], "craft": "CRAFT — …the skill card's rules…", "outputSpec": "{…strict JSON shape…}", "builtIn": true },
  "account": { "id": "…", "currency": "NZD", "today": "2026-09-03" },
  "business": { "name": "…", "oneLiner": "…", "products": [], "audience": "…", "voice": {…}, "market": {…}, "signals": [] },
  "businessSummary": "Business: …\nWhat it is: …",
  "memories": ["[constraint] Never discounts below 15%.", "[fact] …"],
  "founderNotes": "…", "goal": { "title": "…", "deadline": "…", "baseline": 21000, "currency": "NZD" }, "plan": [ … phases … ],
  "priorArtifacts": [{ "id": "…", "kind": "post_set", "routineId": "D01-W01", "title": "…", "status": "approved", "createdAt": "…", "excerpt": "…" }],
  "playbooks": [{ "id": "…", "domain": "content", "title": "…", "body": "… ≤ 700 chars …", "tags": [] }],
  "scopes": [...], "run": { "id": "…", "status": "running", "mode": "dry_run", "startedAt": "…" } }
```

Memories are recalled for the routine's purpose (pinned constraints and preferences first); at
most 3 playbooks. The same truth rules apply to a workflow as to the model: facts and numbers
come from this material, never invented.

#### `POST /api/n8n/actions` — wave-2 shape, gated

```json
{ "platform": "meta_ads", "action": "meta.adset.set_daily_budget", "params": { "adsetId": "…", "increase": 20 }, "target": {…}, "title": "…", "why": "ROAS 3.1 over 7d" }
→ 200 { "queued": true, "approvalId": "…", "receiptId": "…", "executed": false, "executes": "wave_2", "note": "…" }
```

**Today this only records**: a pending approval on the run (the founder sees "Proposed by your
n8n workflow: meta.adset.set_daily_budget on meta_ads" under needs-you and can approve or hold — the
decision is recorded as a taste event) plus a draft receipt "Proposed (not executed)". Nothing is
executed: `LIVE_MODE_ENABLED` stays `false` and no executor is called. Running approved proposals
arrives with wave 2, behind the same gate, spend caps and receipts as every other mutation. The
proxy also requires the platform/action pair to be declared by this exact run's stored spec; a
content token cannot queue an unrelated ad or lifecycle proposal.

### Reply (n8n → Unc), one of

| Status | Body | Effect |
|---|---|---|
| `200` | `{ "artifact": { "kind", "title", "body", "items"?, "meta"?, "evidence"? } }` | validated (declared kind, title, body, ≤ maxItems items, no banned phrase) and stored; the run carries on to its gate |
| `200` | `{ "needs": [ { "input": "brand_notes", "why": "…" }, { "platform": "shopify", "why": "…" } ] }` | the run ends `waiting_input` with the ask; `POST /api/routines/resume-input` re-runs the step with the answers in `inputs` |
| `202` | (empty) | accepted for a Junction-managed bridge only: the persisted run stays `running` with a snapshot until its authenticated callback (the data token stays valid until it expires) |
| anything else | — | the engine receipts the failure and **falls back to the built-in skill** (a produce node); an explicit `n8n` node fails the run closed |

Artifact shape:

```json
{ "kind": "post_set", "title": "3 founder posts: …", "body": "markdown — what these are and what they came from",
  "items": [ { "title": "…", "body": "markdown", "meta": { "platform": "linkedin" } } ],
  "meta": { "model": "…" }, "evidence": [ { "source": "n8n", "ref": "…" } ] }
```

Kinds: `post · post_set · email · hook_list · keyword_list · content_gap · lead_brief ·
outreach_draft · meeting_brief · question_list · calendar · generic`. List kinds need ≥ 1 item.
Numbers in an n8n artifact are trusted (the numbers-only check applies to the model producer);
the workflow owns that truth — so take them from `/api/n8n/reads`, not from a guess.

### Callback (async, n8n → Unc)

This endpoint currently accepts only a Junction-server HMAC over the raw body (±5 min). It is for
Junction-managed bridges, not customer-owned n8n: never copy the root signing secret into an
external workflow to make this work. Customer workflows return `{ artifact }` or `{ needs }`
synchronously. A managed callback answers `{ run }` (200), `401` bad signature, `404` unknown run,
`409` when the persisted run is not waiting on n8n, or `503` when server signing is unavailable.

## Workflow template v2

Webhook trigger → validate the required envelope → `/api/n8n/context` + `/api/n8n/reads` with the
opaque data token → your automation → synchronous `{ artifact }` (or `{ needs }`). Import into n8n
(Workflows → Import from file). **Do not set `N8N_SIGNING_SECRET` in n8n.** Two worked examples
follow; they differ only in the reads they ask for and the artifact they shape.

### Example 1 — Founder content engine (D01-W01)

```json
{
  "name": "Unc — Founder content engine (D01-W01) v2",
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "unc/founder-posts", "responseMode": "responseNode", "options": { "rawBody": true } }, "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0] },
    { "parameters": { "jsCode": "const p = $input.first().json.body ?? $input.first().json;\nif (!p || typeof p !== 'object') throw new Error('missing request body');\nif (!String(p.dataToken || '').startsWith('unc_dt.') || !String(p.dataBaseUrl || '').startsWith('https://')) throw new Error('missing Junction data capability');\nif (!p.runId || !p.accountId || !p.routineId) throw new Error('missing run envelope');\nreturn [{ json: p }];" }, "id": "2", "name": "Validate envelope", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0] },
    { "parameters": { "url": "={{ $json.dataBaseUrl }}/api/n8n/context", "sendHeaders": true, "headerParameters": { "parameters": [{ "name": "Authorization", "value": "=Bearer {{ $json.dataToken }}" }] }, "options": { "timeout": 20000 } }, "id": "3", "name": "Context", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [440, -120] },
    { "parameters": { "url": "={{ $('Validate envelope').item.json.dataBaseUrl }}/api/n8n/reads", "sendQuery": true, "queryParameters": { "parameters": [{ "name": "platform", "value": "shopify" }, { "name": "resource", "value": "products" }, { "name": "limit", "value": "30" }, { "name": "fields", "value": "[\"title\",\"body_html\",\"tags\"]" }] }, "sendHeaders": true, "headerParameters": { "parameters": [{ "name": "Authorization", "value": "=Bearer {{ $('Validate envelope').item.json.dataToken }}" }] }, "options": { "timeout": 20000 } }, "id": "4", "name": "Read products", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [440, 120] },
    { "parameters": { "jsCode": "const p = $('Validate envelope').first().json;\nconst c = $('Context').first().json;\nconst r = $('Read products').first().json;\nconst products = r.ok ? r.rows.map(x => x.title).filter(Boolean) : [];\nconst why = r.ok ? `${r.count} products from Shopify` : `Shopify unavailable (${r.reason}) — profile only`;\nconst prompt = [\n  `You draft LinkedIn / Instagram / X posts in the founder's first person. ${c.routine.craft}`,\n  `BUSINESS:\\n${c.businessSummary}`,\n  `WHAT WE KNOW ABOUT THE FOUNDER:\\n${(c.memories || []).join('\\n')}`,\n  c.founderNotes ? `HOW THEY LIKE TO WORK: ${c.founderNotes}` : '',\n  `PRODUCTS: ${products.join('; ') || 'none read'}`,\n  `CUSTOMER QUESTIONS: ${JSON.stringify(p.reads.questions?.sample ?? [])}`,\n  `Facts and numbers only from the material above. Reply with strict JSON: ${c.routine.outputSpec}`\n].filter(Boolean).join('\\n\\n');\nreturn [{ json: { prompt, why, runId: p.runId } }];" }, "id": "5", "name": "Build prompt", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0] },
    { "parameters": { "model": "gpt-5-mini", "options": { "responseFormat": "json_object" }, "prompt": "={{ $json.prompt }}" }, "id": "6", "name": "Model", "type": "@n8n/n8n-nodes-langchain.openAi", "typeVersion": 1, "position": [880, 0] },
    { "parameters": { "jsCode": "const out = JSON.parse($input.first().json.text ?? $input.first().json.output ?? '{}');\nconst why = $('Build prompt').first().json.why;\nreturn [{ json: { artifact: { kind: 'post_set', title: out.title, body: out.body, items: (out.items ?? []).slice(0, 3), meta: { via: 'n8n', model: 'gpt-5-mini' }, evidence: [{ source: 'n8n', ref: why }, { source: 'n8n', ref: 'context + memories via /api/n8n/context' }] } } }];" }, "id": "7", "name": "Shape artifact", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1100, 0] },
    { "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}", "options": { "responseCode": 200 } }, "id": "8", "name": "Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [1320, 0] }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Validate envelope", "type": "main", "index": 0 }]] },
    "Validate envelope": { "main": [[{ "node": "Context", "type": "main", "index": 0 }, { "node": "Read products", "type": "main", "index": 0 }]] },
    "Context": { "main": [[{ "node": "Build prompt", "type": "main", "index": 0 }]] },
    "Read products": { "main": [[{ "node": "Build prompt", "type": "main", "index": 0 }]] },
    "Build prompt": { "main": [[{ "node": "Model", "type": "main", "index": 0 }]] },
    "Model": { "main": [[{ "node": "Shape artifact", "type": "main", "index": 0 }]] },
    "Shape artifact": { "main": [[{ "node": "Respond", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

### Example 2 — Customer-question mining from Shopify (D01-W03)

Shopify's Admin API has no reviews resource of its own (reviews live in the review app), so the
workflow mines what Shopify does answer — product copy, tags and the questions each page invites —
and, when the founder pasted real questions (`inputs.customer_questions`), ranks those first. Same
skeleton as example 1; only the reads and the shaping differ:

```json
{
  "name": "Unc — Customer-question mining (D01-W03) v2",
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "unc/customer-questions", "responseMode": "responseNode", "options": { "rawBody": true } }, "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0] },
    { "parameters": { "jsCode": "const p = $input.first().json.body ?? $input.first().json;\nif (!p || typeof p !== 'object') throw new Error('missing request body');\nif (!String(p.dataToken || '').startsWith('unc_dt.') || !String(p.dataBaseUrl || '').startsWith('https://')) throw new Error('missing Junction data capability');\nif (!p.runId || !p.accountId || !p.routineId) throw new Error('missing run envelope');\nreturn [{ json: p }];" }, "id": "2", "name": "Validate envelope", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0] },
    { "parameters": { "url": "={{ $json.dataBaseUrl }}/api/n8n/context", "sendHeaders": true, "headerParameters": { "parameters": [{ "name": "Authorization", "value": "=Bearer {{ $json.dataToken }}" }] }, "options": { "timeout": 20000 } }, "id": "3", "name": "Context", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [440, -120] },
    { "parameters": { "url": "={{ $('Validate envelope').item.json.dataBaseUrl }}/api/n8n/reads", "sendQuery": true, "queryParameters": { "parameters": [{ "name": "platform", "value": "shopify" }, { "name": "resource", "value": "products" }, { "name": "limit", "value": "50" }, { "name": "fields", "value": "[\"title\",\"body_html\",\"tags\",\"product_type\"]" }] }, "sendHeaders": true, "headerParameters": { "parameters": [{ "name": "Authorization", "value": "=Bearer {{ $('Validate envelope').item.json.dataToken }}" }] }, "options": { "timeout": 20000 } }, "id": "4", "name": "Read products", "type": "n8n-nodes-base.httpRequest", "typeVersion": 4.2, "position": [440, 120] },
    { "parameters": { "jsCode": "const p = $('Validate envelope').first().json;\nconst c = $('Context').first().json;\nconst r = $('Read products').first().json;\nconst pasted = p.inputs?.customer_questions || '';\nconst products = r.ok ? r.rows.map(x => ({ title: x.title, text: String(x.body_html || '').replace(/<[^>]+>/g, ' ').slice(0, 600), tags: x.tags })) : [];\nif (!pasted && !products.length) return [{ json: { needs: [{ platform: 'shopify', why: r.ok ? 'no products came back to mine' : `couldn't read Shopify: ${r.reason}` }, { input: 'customer_questions', why: 'or paste the last 10–20 questions customers asked you' }] } }];\nconst prompt = [\n  `${c.routine.craft}`,\n  `BUSINESS:\\n${c.businessSummary}`,\n  `WHAT WE KNOW ABOUT THE FOUNDER:\\n${(c.memories || []).join('\\n')}`,\n  pasted ? `QUESTIONS THE FOUNDER PASTED (real — rank these first):\\n${pasted}` : 'No real questions yet — mine the product pages and say so in the body.',\n  `PRODUCT PAGES (${products.length}):\\n${JSON.stringify(products)}`,\n  `No invented frequencies. Reply with strict JSON: ${c.routine.outputSpec}`\n].join('\\n\\n');\nreturn [{ json: { prompt, evidence: [{ source: 'n8n', ref: pasted ? 'questions the founder pasted' : `${products.length} Shopify product pages via /api/n8n/reads` }] } }];" }, "id": "5", "name": "Build prompt or ask", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [660, 0] },
    { "parameters": { "conditions": { "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "strict" }, "conditions": [{ "leftValue": "={{ $json.needs ? 'needs' : 'go' }}", "rightValue": "needs", "operator": { "type": "string", "operation": "equals" } }], "combinator": "and" } }, "id": "6", "name": "Needs?", "type": "n8n-nodes-base.if", "typeVersion": 2, "position": [880, 0] },
    { "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify({ needs: $json.needs }) }}", "options": { "responseCode": 200 } }, "id": "7", "name": "Respond needs", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [1100, -140] },
    { "parameters": { "model": "gpt-5-mini", "options": { "responseFormat": "json_object" }, "prompt": "={{ $json.prompt }}" }, "id": "8", "name": "Model", "type": "@n8n/n8n-nodes-langchain.openAi", "typeVersion": 1, "position": [1100, 120] },
    { "parameters": { "jsCode": "const out = JSON.parse($input.first().json.text ?? $input.first().json.output ?? '{}');\nconst evidence = $('Build prompt or ask').first().json.evidence;\nreturn [{ json: { artifact: { kind: 'question_list', title: out.title, body: out.body, items: (out.items ?? []).slice(0, 10), meta: { via: 'n8n', model: 'gpt-5-mini' }, evidence } } }];" }, "id": "9", "name": "Shape artifact", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [1320, 120] },
    { "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}", "options": { "responseCode": 200 } }, "id": "10", "name": "Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [1540, 120] }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Validate envelope", "type": "main", "index": 0 }]] },
    "Validate envelope": { "main": [[{ "node": "Context", "type": "main", "index": 0 }, { "node": "Read products", "type": "main", "index": 0 }]] },
    "Context": { "main": [[{ "node": "Build prompt or ask", "type": "main", "index": 0 }]] },
    "Read products": { "main": [[{ "node": "Build prompt or ask", "type": "main", "index": 0 }]] },
    "Build prompt or ask": { "main": [[{ "node": "Needs?", "type": "main", "index": 0 }]] },
    "Needs?": { "main": [[{ "node": "Respond needs", "type": "main", "index": 0 }], [{ "node": "Model", "type": "main", "index": 0 }]] },
    "Model": { "main": [[{ "node": "Shape artifact", "type": "main", "index": 0 }]] },
    "Shape artifact": { "main": [[{ "node": "Respond", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

Customer-owned workflows should reply synchronously within the configured bridge timeout. Do not
give them `N8N_SIGNING_SECRET` to enable an async callback. The current HMAC callback is reserved
for Junction-managed infrastructure that already shares the server boundary; a future per-run
callback credential can open async completion without exposing the token-signing root.

## What makes a workflow a good skill

Read the matching card in `src/lib/runtime/skills/<routine>.ts` — or just call `/api/n8n/context`:
`routine.minimum` says what the run will have, `routine.craft` is the craft Unc holds itself to
(voice, no invented facts, evidence lines), `routine.outputSpec` is the exact JSON. Return
`needs` rather than guessing when the material is thin — the founder gets an honest ask instead
of a hollow draft. Read numbers through `/api/n8n/reads`; an `ok:false` answer is "couldn't ask",
so say so in the body rather than inventing a figure.

## Module map

| Path | What |
|---|---|
| `src/lib/n8n/dataToken.ts` | issue / verify the run-scoped token, scopes from a spec, the per-token rate limit |
| `src/lib/n8n/proxy.ts` | `authenticate`, `readForToken`, `contextForToken`, `proposeAction` (the three routes' logic) |
| `src/lib/n8n/routeDeps.ts` | the real deps from the environment (store, credentials, service role, secret) |
| `src/lib/n8n/registry.ts` | skill sources, register / patch, the test call, admin emails |
| `src/app/api/n8n/{reads,context,actions}/route.ts` | the proxy |
| `src/app/api/skills/n8n/route.ts`, `…/test/route.ts` | the registry API |
| `src/components/platform/SkillsSettings.tsx` | the Skills settings |
| `src/worker/providers/n8n.ts` | the bridge (signed POST, the payload with the token, reply parsing) |
| `src/worker/providers/pinnedWebhookFetch.ts` | DNS-pinned HTTPS transport and bounded response collection |
| `src/lib/runtime/engine.ts` `produce()` | n8n first when registered; fallback to the producer with a receipt |
