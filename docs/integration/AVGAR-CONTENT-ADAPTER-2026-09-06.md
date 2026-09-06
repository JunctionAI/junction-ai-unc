# AVGAR Content adapter — 6 September 2026

Isolated branch work. Not deployed. No live n8n, Slack, credential or database change.

## Exact mappings (not invented)

| Unc ID | Catalog name | Artifact kind | Existing n8n | Historical evidence | Current seed |
|---|---|---|---|---|---|
| D01-W02 | Viral hook mining | `hook_list` | `lMXjTgd3Qh4vZaMp` rev `c8d6955d-0033-47ce-9672-399f7f10118c` | exec #68 / #58 lineage; packaged `content_hooks` | must be `golf travel bag` |
| D01-W03 | Customer-question mining | `question_list` | same workflow/revision | exec #68 PAA; packaged `content_questions` | must be `golf travel bag` |

No n8n mapping exists for D01-W01, D01-W04, D01-W05, D01-W06, D01-W07, D01-W08. Those stay built-in catalog skills. Email/Klaviyo is out of scope.

Nguyen’s packaged examples are **historical provider proof only** (`not_current_avgar_golf_market_context: true`, seed `travel bag`, kinds `content_hooks` / `content_questions`). They are not current AVGAR Unc runs and fail the new contract until rebuilt for `hook_list` / `question_list` + `golf travel bag`.

## What this branch implements

- Contract `unc.content-search-shadow.v1` (AVGAR account `aa5cfc84-2569-4c99-9b40-67003ae55eda` only).
- Spec adapter: strips TikTok/Instagram/Gorgias reads; manual n8n producer; search hypotheses only.
- In-app command market matching for US/NZ/AU (2840/2554/2036). Slack routing unchanged; Slack Content commands are refused.
- Simulated engine path: admission → authority POST → independent execution read → `hook_list` draft + receipts.
- Receiver helpers Nguyen can copy (`contentReceiver.ts`) to emit Unc kinds from SERP organic / People Also Ask rows.

## Tests vs real provider execution

All tests in this branch are **simulated**. They use synthetic DataForSEO-shaped rows, fake n8n executions, and fake admission ledgers. **Zero live DataForSEO, n8n Cloud, Slack or customer messages.**

## Remaining blockers

**Nguyen**
1. Publish two Unc receivers (do not edit the shared live TEST workflow in place):
   - `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w02/hooks-shadow`
   - `https://junctionai8.app.n8n.cloud/webhook/unc/d01-w03/questions-shadow`
2. Each receiver must call `/api/n8n/content-shadow-authority` (POST), run DataForSEO SERP for the contracted seed/location, and return only that routine’s Unc kind plus `executionReceipt`.
3. Keep Header Auth / DataForSEO credentials in n8n. Do not embed secrets. Label search hypotheses. Do not claim TikTok views or ticket frequency.
4. Return the published revision, webhook node IDs, and three saved-data fixtures (US/NZ/AU) for `golf travel bag`. Historical #68 must stay untouched.

**Codex**
1. Apply durable Content admission SQL (`issue_content_shadow_run`, `transition_content_shadow`) — not in this branch; RPCs are called from code and stubbed in tests.
2. Pin env (not committed): `N8N_CONTENT_HOOKS_SHADOW_RECEIVER_URL/TOKEN`, `N8N_CONTENT_QUESTIONS_SHADOW_RECEIVER_URL/TOKEN`, `N8N_CONTENT_SHADOW_WORKFLOW_ID/TRIGGER_NODE_ID/RESULT_NODE_ID`. Tokens must differ from the keyword and calendar receiver credentials and from `N8N_SIGNING_SECRET`.
3. Register account-specific n8n rows for AVGAR D01-W02 and D01-W03 after Nguyen’s receivers exist.
4. Open a timed command-release scope for AVGAR app + those two routine fingerprints. Do not enable schedules or unpause from this work.
5. Independent live round-trip is still required before claiming customer-useful Content output.

Account pause, routine switches, Slack cutover and publishing remain operator-gated and were not changed here.
