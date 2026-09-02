# n8n as Unc's skills

A routine's **produce** step can be served by one of Tom's n8n workflows instead of the built-in
`LlmProducer`. Register a webhook per routine; the engine POSTs the run's material to it, signed,
and stores whatever Artifact comes back exactly as it would a producer's — same receipt, same gate,
same "What I drafted" card. Nothing outward ever happens from n8n's answer: it is a draft.

## Register a workflow

```sql
-- one routine, every account (account_id null = global)
insert into n8n_workflows (routine_id, webhook_url) values ('D01-W01', 'https://n8n.example/webhook/founder-posts');
-- one account only (wins over the global row)
insert into n8n_workflows (account_id, routine_id, webhook_url) values ('<account uuid>', 'D03-W01', 'https://n8n.example/webhook/keywords-acme');
-- switch one off without deleting it
update n8n_workflows set active = false where id = '<id>';
```

Service role only (RLS denies every client role). Env on the app + worker: `N8N_SIGNING_SECRET`
(required — the bridge refuses to call unsigned). A spec can also carry an explicit `n8n` node
with `webhookUrl` or `webhookUrlEnv` (the name of an env variable holding the URL) and an optional
`timeoutMs`; without either it falls back to the registered row.

## The contract

### Request (Unc → n8n)

`POST <webhook_url>` · `content-type: application/json`
`x-unc-timestamp: <ms since epoch>` · `x-unc-signature: sha256=<hex HMAC-SHA256(secret, "<timestamp>.<raw body>")>`

```json
{
  "accountId": "…", "runId": "…", "routineId": "D01-W01", "skill": "D01-W01", "kind": "post_set",
  "mode": "dry_run", "startedAt": "2026-09-03T07:00:00.000Z",
  "account": { "currency": "NZD", "budgetMonthly": 3000 },
  "inputs": { "about_the_business": "…" },
  "vars": { "website": "acme.test" },
  "reads": { "questions": { "count": 12, "provenance": "ok", "metrics": {}, "sample": [ … ≤ 8 rows … ] } },
  "callback": { "path": "/api/routines/artifacts", "signatureHeader": "x-unc-signature", "timestampHeader": "x-unc-timestamp" }
}
```

`reads` are the run's platform reads compacted to ~7 KB (`provenance: "unavailable"` = couldn't
ask). `kind` is the artifact kind the skill expects.

### Reply (n8n → Unc), one of

| Status | Body | Effect |
|---|---|---|
| `200` | `{ "artifact": { "kind", "title", "body", "items"?, "meta"?, "evidence"? } }` | validated (declared kind, title, body, ≤ maxItems items, no banned phrase) and stored; the run carries on to its gate |
| `200` | `{ "needs": [ { "input": "brand_notes", "why": "…" }, { "platform": "shopify", "why": "…" } ] }` | the run ends `waiting_input` with the ask; `POST /api/routines/resume-input` re-runs the step with the answers in `inputs` |
| `202` | (empty) | accepted: the run stays `running` with a snapshot; the workflow POSTs the callback later |
| anything else | — | the run fails closed with a receipt naming the status |

Artifact shape:

```json
{ "kind": "post_set", "title": "3 founder posts: …", "body": "markdown — what these are and what they came from",
  "items": [ { "title": "…", "body": "markdown", "meta": { "platform": "linkedin" } } ],
  "meta": { "model": "…" }, "evidence": [ { "source": "n8n", "ref": "…" } ] }
```

Kinds: `post · post_set · email · hook_list · keyword_list · content_gap · lead_brief ·
outreach_draft · meeting_brief · question_list · calendar · generic`. List kinds need ≥ 1 item.
Numbers in an n8n artifact are trusted (the numbers-only check applies to the model producer);
the workflow owns that truth.

### Callback (async, n8n → Unc)

`POST <APP_URL>/api/routines/artifacts` with the same two headers (HMAC over the raw body, ±5 min)
and body `{ "runId": "<from the request>", "artifact": { … } }` or `{ "runId", "needs": [ … ] }`.
Answers `{ run }` (200), `401` bad signature, `404` unknown run, `409` the run is not waiting on
n8n, `503` no secret configured.

## Workflow template

Import into n8n (Workflows → Import from file). It receives the payload, verifies the signature,
builds a post set with a model node of your choice, and replies synchronously.

```json
{
  "name": "Unc — Founder content engine (D01-W01)",
  "nodes": [
    { "parameters": { "httpMethod": "POST", "path": "unc/founder-posts", "responseMode": "responseNode", "options": { "rawBody": true } }, "id": "1", "name": "Webhook", "type": "n8n-nodes-base.webhook", "typeVersion": 2, "position": [0, 0] },
    { "parameters": { "jsCode": "const crypto = require('crypto');\nconst secret = $env.N8N_SIGNING_SECRET;\nconst raw = $input.first().binary?.data ? Buffer.from($input.first().binary.data.data, 'base64').toString() : JSON.stringify($input.first().json.body);\nconst h = $input.first().json.headers;\nconst ts = h['x-unc-timestamp'];\nconst sig = 'sha256=' + crypto.createHmac('sha256', secret).update(`${ts}.${raw}`).digest('hex');\nif (sig !== h['x-unc-signature']) throw new Error('bad signature');\nif (Math.abs(Date.now() - Number(ts)) > 300000) throw new Error('stale');\nreturn [{ json: JSON.parse(raw) }];" }, "id": "2", "name": "Verify signature", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [220, 0] },
    { "parameters": { "jsCode": "const p = $input.first().json;\nconst profile = p.inputs.about_the_business || 'the business';\nreturn [{ json: { prompt: `Write three founder-voice posts for ${profile}. Use ONLY these customer questions: ${JSON.stringify(p.reads.questions?.sample ?? [])}. Reply as JSON {title, body, items:[{title, body, meta:{platform}}]}` , routineId: p.routineId, runId: p.runId } }];" }, "id": "3", "name": "Build prompt", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [440, 0] },
    { "parameters": { "model": "gpt-5-mini", "options": { "responseFormat": "json_object" }, "prompt": "={{ $json.prompt }}" }, "id": "4", "name": "Model", "type": "@n8n/n8n-nodes-langchain.openAi", "typeVersion": 1, "position": [660, 0] },
    { "parameters": { "jsCode": "const out = JSON.parse($input.first().json.text ?? $input.first().json.output ?? '{}');\nreturn [{ json: { artifact: { kind: 'post_set', title: out.title, body: out.body, items: (out.items ?? []).slice(0, 3), meta: { via: 'n8n', model: 'gpt-5-mini' }, evidence: [{ source: 'n8n', ref: 'customer questions from the run' }] } } }];" }, "id": "5", "name": "Shape artifact", "type": "n8n-nodes-base.code", "typeVersion": 2, "position": [880, 0] },
    { "parameters": { "respondWith": "json", "responseBody": "={{ JSON.stringify($json) }}", "options": { "responseCode": 200 } }, "id": "6", "name": "Respond", "type": "n8n-nodes-base.respondToWebhook", "typeVersion": 1, "position": [1100, 0] }
  ],
  "connections": {
    "Webhook": { "main": [[{ "node": "Verify signature", "type": "main", "index": 0 }]] },
    "Verify signature": { "main": [[{ "node": "Build prompt", "type": "main", "index": 0 }]] },
    "Build prompt": { "main": [[{ "node": "Model", "type": "main", "index": 0 }]] },
    "Model": { "main": [[{ "node": "Shape artifact", "type": "main", "index": 0 }]] },
    "Shape artifact": { "main": [[{ "node": "Respond", "type": "main", "index": 0 }]] }
  },
  "settings": { "executionOrder": "v1" }
}
```

For a long-running workflow, respond `202` from the Webhook node immediately (respond mode
"Immediately", response code 202), do the work, then an HTTP Request node POSTs the callback with
the two headers computed the same way (`x-unc-timestamp` = `Date.now()`, signature over
`${ts}.${body}`).

## What makes a workflow a good skill

Read the matching card in `src/lib/runtime/skills/<routine>.ts`: its `minimum` says what the run
will have, its `prompt` is the craft Unc holds itself to (voice, no invented facts, evidence
lines), its `outputSpec` is the exact JSON. Return `needs` rather than guessing when the material
is thin — the founder gets an honest ask instead of a hollow draft.
