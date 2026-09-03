# Models — the provider layer

*Founder decision 5 (2026-09-02): Unc is not hard-wired to one vendor. Every model call goes
through `src/lib/llm/` — a small router with per-task and per-account model choice.*

Copy in the app: **"Which brain for which job — I default to the best value for each."**

## The five founder-configurable tasks

| Task | Where | Default | Budget kept from before |
|---|---|---|---|
| `chat` | `POST /api/unc/chat` | `claude-sonnet-5` | 2000 tokens, effort low |
| `plan_narrative` | `POST /api/unc/narrative` | `claude-sonnet-5` | 4000 tokens, effort medium, JSON |
| `business_scan` | `src/lib/unc/scan.ts` (via `POST /api/unc/scan`) | **fast tier** (`claude-haiku-4-5` when Anthropic is configured) | 4000 tokens, effort low, JSON |
| `self_review` | `POST /api/unc/self-review` + worker `--self-review` | `claude-sonnet-5` | 4000 tokens, effort low, JSON |
| `routine_decision` | worker `LlmDecisionProvider` (llm-rule decide nodes) | **fast tier** | 4000 tokens, effort low, JSON |

Budgets are generous on purpose: Sonnet 5 / Opus 5 think adaptively and the thinking tokens
count against `max_tokens` (a tight cap starves the visible answer). Effort stays pinned low
for the mechanical jobs. Every call site keeps the exact validator and fallback it had when
the Anthropic SDK was inline — a refusal, a transport error or "nothing configured" lands on
the canned / deterministic path, never on the founder.

Internal tasks use the same router but do not appear in account settings. Most important for
the routine system is `routine_produce`: balanced tier by default, 8000 tokens, effort medium,
strict JSON, overrideable with `LLM_MODEL_ROUTINE_PRODUCE`. It writes the artifact behind each
of the 35 skill contracts. `memory_extract`, `daily_brief`, `kpi_insight`, `eval_judge`, and
`niche_brief` are also internal; their defaults live in `src/lib/llm/router.ts`.

## Providers

| Provider id | Adapter | Env | Default base URL |
|---|---|---|---|
| `anthropic` | `providers/anthropic.ts` (official SDK, `maxRetries: 1`, `output_config.effort`) | `ANTHROPIC_API_KEY` | SDK default |
| `openai` | `providers/openaiCompatible.ts` | `OPENAI_API_KEY`, optional `OPENAI_BASE_URL` | `https://api.openai.com/v1` |
| `gemini` | `providers/openaiCompatible.ts` | `GEMINI_API_KEY`, optional `GEMINI_BASE_URL` | `https://generativelanguage.googleapis.com/v1beta/openai` |
| `openrouter` | `providers/openaiCompatible.ts` (+ `X-Title` header) | `OPENROUTER_API_KEY`, optional `OPENROUTER_BASE_URL` | `https://openrouter.ai/api/v1` |
| `custom` | `providers/openaiCompatible.ts` | `LLM_CUSTOM_BASE_URL` (required), `LLM_CUSTOM_API_KEY`, `LLM_CUSTOM_MODEL`, `LLM_CUSTOM_INPUT_PER_1M`, `LLM_CUSTOM_OUTPUT_PER_1M`, `LLM_CUSTOM_REASONING_EFFORT=1`, `LLM_CUSTOM_STREAM_USAGE=0` | — |

A provider is *configured* when its key is present (`custom`: when the base URL is). Keys are
read from `process.env` only, never logged, never sent to the client; the OpenAI-compatible
adapter puts the key in the `Authorization` header and nowhere else.

The OpenAI-compatible adapter speaks `POST {baseUrl}/chat/completions` over `fetch`, streams
(SSE) so the **10 s connect** budget (headers must arrive) and the **60 s total** budget are
real, sends `max_completion_tokens` to OpenAI and `max_tokens` to everyone else,
`reasoning_effort` where supported, `response_format: {type: "json_object"}` in JSON mode and
`stream_options.include_usage` for the token counts. A server that answers plain JSON instead
of a stream is parsed too. Live-verified 2026-09-02: OpenAI (`gpt-5-mini`), Gemini
(`gemini-2.5-flash`) and Anthropic (`claude-sonnet-5`) all return `pong` with usage.

## The catalogue (`src/lib/llm/registry.ts`)

Prices are **approximate USD list prices per 1M tokens**, maintained by hand (no caching,
batch or long-context adjustments). They drive the settings UI and the ledger's `est_cost_usd`;
they are not a bill.

| id | provider | tier | in / out $ per 1M |
|---|---|---|---|
| `claude-haiku-4-5` | anthropic | fast | 1 / 5 (rejects `effort` — the router strips it) |
| `claude-sonnet-5` | anthropic | balanced | 2 / 10 |
| `claude-opus-5` | anthropic | best | 5 / 25 |
| `gpt-5-nano` | openai | fast | 0.05 / 0.40 |
| `gpt-5-mini` | openai | fast | 0.25 / 2 |
| `gpt-5` | openai | balanced | 1.25 / 10 |
| `gemini-2.5-flash` | gemini | fast | 0.30 / 2.50 |
| `gemini-2.5-pro` | gemini | best | 1.25 / 10 |
| `custom` | custom | balanced | from `LLM_CUSTOM_*_PER_1M`, else unknown |

**Ad-hoc ids** — an operator can name `<provider>:<model>` through `LLM_MODEL_<TASK>` (for
example `openrouter:deepseek/deepseek-chat`). Arbitrary hosted ids resolve with unknown cost and
an account-scoped call refuses them as `unpriced_model` before the network. The one automatic
exception is an OpenRouter `openai/<catalogue model>` mirror, which reuses that maintained OpenAI
estimate. The account settings API accepts catalogue ids only.

Tier stand-ins when a request has to move providers (`TIER_EQUIVALENTS`):
anthropic haiku/sonnet/opus · openai gpt-5-mini/gpt-5/gpt-5 · gemini flash/pro/pro ·
openrouter `openai/gpt-5-mini` / `openai/gpt-5` / `openai/gpt-5` · custom → custom.

## Precedence

```
account setting  (account_model_prefs — the founder's pick in Models)
  → env LLM_MODEL_<TASK>   (LLM_MODEL_CHAT, LLM_MODEL_PLAN_NARRATIVE, LLM_MODEL_BUSINESS_SCAN,
                            LLM_MODEL_SELF_REVIEW, LLM_MODEL_ROUTINE_DECISION)
    → task default (table above)
```

If the chosen model's provider isn't configured, the **same tier on the first configured
provider** (anthropic → openai → gemini → openrouter → custom) stands in and the result says
so (`source: "fallback"`, `fallbackFrom`). An unknown id is skipped, not fatal. With no provider
configured at all `resolveModel` returns `null` and the call site keeps its canned fallback —
demo mode is byte-identical to before.

Per-account choice reaches every task: the session-bound routes pass the account, the
onboarding routes (chat/scan/narrative) attach it when a signed-in founder is calling
(`optionalAccountContext`), and the worker's shared clients receive `accountId` per prompt.

## The settings surface

Sidebar bottom, DB mode only: **Models ·** (demo mode never shows it). One select per task
with tier and approximate cost; providers without a key are listed as "not connected" and
disabled. Members may inspect the resolved choices, but only the server-verified account owner
may save through `POST /api/settings/models`; the body must name a maintained catalogue id.
`null` returns a task to its default. Table RLS remains an additional tenant boundary.
Direct authenticated writes to `account_model_prefs` are revoked; the owner-checked route writes
through the service role.

## Cost admission and telemetry

Before an account-scoped hosted call, the router computes a conservative ceiling from UTF-8 input
bytes plus the full output-token cap. The service-role-only `reserve_llm_spend` RPC locks that
account, totals current-UTC-month `llm_usage` plus every still-active reservation, and admits the
ceiling only when it fits the account cap. Missing database/RPC access fails closed as
`budget_unavailable`; an unpriced hosted model fails as `unpriced_model`. Embedding batches use the
same rail. `text-embedding-3-small` carries its maintained price; any non-default
`EMBEDDING_MODEL` also requires a finite positive `EMBEDDING_INPUT_PER_1M`.

Every provider call then attempts one `llm_usage` row (migration `0008`): `account_id` (nullable —
pre-account/demo work and the dev ping), `task`, `provider`, `model`, `input_tokens`,
`output_tokens`, `est_cost_usd`, `latency_ms`, `stop_reason`
(`end | max_tokens | refusal | error:<code>`), `created_at`. Service role writes; members can read
their own account's rows. The reservation is released only after that row is durable. If the
ledger insert or release fails, its conservative ceiling remains through the admission month plus
a 30-minute rollover buffer; operators investigate before releasing it. Without an account, no
cap applies and a missing database emits the same record as a JSON log line.

The `custom` provider is an operator-trusted self-hosted exception when both prices are absent or
both are zero: it still requires a fresh readable cap for account work, but has no variable vendor
amount to reserve. Supplying complete positive/non-negative `LLM_CUSTOM_INPUT_PER_1M` and
`LLM_CUSTOM_OUTPUT_PER_1M` pricing moves it onto the same atomic reservation path as hosted
providers; partial pricing is refused.

Quick look: `select task, provider, model, count(*), sum(est_cost_usd), avg(latency_ms) from
llm_usage where created_at > now() - interval '7 days' group by 1,2,3 order by 5 desc;`

## The "India / cost" lever — route mechanics to fast tiers

The mechanical jobs (`business_scan`, `routine_decision`) already default to the fast tier.
To push further, or to run a whole deployment on the cheapest capable models:

```
LLM_MODEL_BUSINESS_SCAN=gpt-5-nano          # or gemini-2.5-flash, claude-haiku-4-5
LLM_MODEL_ROUTINE_DECISION=gemini-2.5-flash
LLM_MODEL_SELF_REVIEW=gpt-5-mini            # the weekly review is short JSON — a fast model holds up
LLM_MODEL_CHAT=claude-sonnet-5              # keep the words that face the founder on a stronger model
LLM_MODEL_PLAN_NARRATIVE=claude-sonnet-5
```

Or a self-hosted endpoint for the mechanics only:

```
LLM_CUSTOM_BASE_URL=http://gpu-box:8000/v1   LLM_CUSTOM_MODEL=qwen3-32b
LLM_CUSTOM_INPUT_PER_1M=0.05                 LLM_CUSTOM_OUTPUT_PER_1M=0.10
LLM_MODEL_ROUTINE_DECISION=custom            LLM_MODEL_BUSINESS_SCAN=custom
```

Then watch `llm_usage`: if `stop_reason` starts showing `max_tokens` or the validators start
rejecting (`liveFields` drops, `decision.llm_rejected` in the worker log), the tier is too low
for that job — move it one up. The validators are the safety net: a weak model can only ever
produce the deterministic fallback, never a wrong number.

## Adding a provider

1. If it speaks `/chat/completions`, no adapter is needed: add a `ProviderId`, an entry in
   `PROVIDER_ENV` (key + base URL), a `TIER_EQUIVALENTS` row and a factory case in
   `providers/index.ts` (pick `maxTokensParam`, `supportsReasoningEffort`, `streamUsage`).
2. Otherwise write `providers/<name>.ts` implementing `LlmProvider { id, complete(req) }` —
   return an `LlmResult`, never throw; map failures to an `LlmErrorCode`.
3. Add catalogue entries with approximate prices and a `supportsEffort` flag.
4. Tests: `src/lib/llm/__tests__/` — request shaping with a mocked `fetch`/client, error mapping,
   and a `resolveModel` case for the new fallback order.
5. `GET /api/llm/ping?model=<id>` (dev only; 404 in production) to smoke it live.

## Files

`src/lib/llm/types.ts` · `registry.ts` · `router.ts` · `budget.ts` · `embed.ts` · `errors.ts` ·
`prefs.ts` · `telemetry.ts` · `accountContext.ts` · `providers/{anthropic,openaiCompatible,index}.ts` ·
`src/app/api/settings/models/route.ts` · `src/app/api/llm/ping/route.ts` ·
`src/components/platform/ModelSettings.tsx` · `supabase/migrations/0008_model_prefs_llm_usage.sql` ·
`supabase/migrations/20260903211025_llm_spend_reservations.sql`

The worker's standalone build has no `@/` alias: everything under `src/lib/llm` uses relative
imports (see `src/worker/README.md`).
