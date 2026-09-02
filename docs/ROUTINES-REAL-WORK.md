# Routines produce real work

*2026-09-03. The founder's first live run: three routines on, dry-ran in seconds, read nothing (no
connectors), finished "Nothing worth drafting today". From his side nothing was set up. This is the
fix: every wave-1 routine now ends in an **artifact** — a post set, an email, a keyword list, a
brief — or an honest ask for what it needs. Never a silent skip.*

## The shape

```
TRIGGER → READ* (optional) → PRODUCE → GATE → RECEIPT
```

| Node | What it does now |
|---|---|
| `read` with `optional: true` | A read that cannot be asked (nothing connected, no reader, an error) lands as an empty result with provenance `unavailable` **and a receipt saying so** — the chain carries on. Wave-1 reads are optional except the one that defines the routine (Abandoned cart → Shopify checkouts). |
| `produce` | The routine's **skill card** (`src/lib/runtime/skills/<routine>.ts`) makes the artifact through the injected `Producer` (`src/worker/providers/producer.ts` `LlmProducer`). The engine stores it (`Store.putArtifact`), writes a `draft` receipt **linking the artifact id**, and the gate preview carries it. Dry-run and live both produce — producing is never outward. |
| `n8n` / registered workflow | When an active `n8n_workflows` row exists for the routine (account row first, then global), the engine hands the produce step to Tom's n8n workflow instead — see `docs/N8N-ROUTINES.md`. |
| `waiting_input` (run status) | The producer answered `needs` (a platform to connect, or a founder input). Receipt: *"To draft this I need: …"*. The run holds a snapshot **at the produce node**; `POST /api/routines/resume-input {runId, answers}` merges the answers into `ctx.inputs` and re-runs it. |

Every wave-1 spec also carries `minimum` (from its skill) so the UI can say **"Needs: X"** from data
(`RoutineSpec.minimum = { summary, platforms, inputs, helpful }`).

## Module map

| Path | What |
|---|---|
| `src/lib/runtime/types.ts` | `ArtifactKind`, `Artifact`, `ArtifactDraft`, `ProduceNeed`, `ProduceResult`, `ProduceNode`, `N8nNode`, `Producer`, `N8nBridge`, `N8nWorkflow`, `SpecMinimum`; `RunStatus` + `waiting_input`; `ReadNode.optional`; `RunContext.inputs / artifact`; `RunResult.artifact / needs` |
| `src/lib/runtime/engine.ts` | the produce / n8n steps, optional reads, `waiting_input`, `resumeRunWithInput`, `completeExternalArtifact`, `describeNeed(s)`, `cleanAnswers` |
| `src/lib/runtime/validate.ts` | node order `trigger→read→check→decide→produce|n8n→gate→execute→receipt` |
| `src/lib/runtime/skills/*.ts` | the ten wave-1 skill cards + `types.ts` (SkillContext, shared checks) + `index.ts` (`SKILL_BY_ID`) |
| `src/lib/runtime/catalog-specs.ts` | wave-1 chains rewritten around `produce`; `optRead`, `produce` builders; `spec.minimum` |
| `src/lib/runtime/store/{interface,memory,supabase}.ts` | `putArtifact / getArtifact / updateArtifact / listArtifacts`, `findN8nWorkflow / putN8nWorkflow`, `RunSnapshot.needs / awaiting` |
| `src/lib/artifacts/validate.ts` | `parseArtifactReply` / `validateArtifactObject`: kind, title, body, ≤ maxItems, banned phrases, **numbers only from the evidence** |
| `src/lib/artifacts/material.ts` | `compactReads` (prompt-sized reads), `skillContextFrom` |
| `src/lib/artifacts/markdown.ts` | the dependency-free markdown reader (`parseMarkdown`, `markdownToPlain`, `firstLines`) |
| `src/lib/artifacts/signing.ts` | HMAC `sign` / `verify` for the n8n bridge and its callback |
| `src/lib/artifacts/handlers.ts` | `listArtifactsForAccount`, `getArtifactForAccount`, `decideArtifact` (status + taste_event + memory) |
| `src/worker/providers/producer.ts` | `LlmProducer` (skill check → prompt → validate → retry → honest ask), `DbProducerContext` (profile, memories, goal, plan, notes, prior artifacts), `PRODUCE_SYSTEM`, `buildProducePrompt`, `createProducerClient` (task `routine_produce`, balanced tier) |
| `src/worker/providers/n8n.ts` | `HttpN8nBridge`, `buildN8nPayload`, `parseN8nReply` |
| `src/worker/service.ts` | `buildAdapters` wires producer + bridge; `resumeWithInput`; `completeExternal`; `setProducerForTests` |
| `src/app/api/artifacts/route.ts`, `src/app/api/artifacts/[id]/route.ts` | list · open · approve / hold / edit / why / use · send on a linked channel |
| `src/app/api/routines/resume-input/route.ts` | answer a waiting run |
| `src/app/api/routines/artifacts/route.ts` | the signed n8n callback |
| `src/components/platform/{Drafts,DraftCard}.tsx` | "What I drafted" on Home: the real artifacts, open → markdown + items + Approve / Hold (why) / Why / Edit / Copy / Send me this on … |
| `src/components/platform/RoutineDetail.tsx` | "Last draft", the node canvas with PRODUCE, "Needs: …" from `spec.minimum`, optional sources marked |
| `src/components/platform/RunNowPanel.tsx` | `waiting_input` renders the ask with answer boxes → resume-input from the same panel |
| `supabase/migrations/0013_artifacts.sql` | `artifacts`, `n8n_workflows`, `routine_runs.status` + `waiting_input`, RLS |

## The skills and their minimums

| Routine | Kind | Minimum (honest) | Helpful when connected | Asks for (waiting_input) |
|---|---|---|---|---|
| D01-W01 Founder content engine | post_set ×3 | a scanned site profile **or** 3 memories about the business | Gorgias, LinkedIn, Shopify | `about_the_business` |
| D01-W03 Customer-question mining | question_list ≤10 | tickets / reviews / comments — or the scanned site's FAQ/product text | Gorgias, Shopify, Instagram | `customer_questions` (or connect Gorgias) |
| D01-W05 Social repurposing | post_set ×5 | ≥1 recent post from a social read, or one the founder pastes | Instagram, LinkedIn, YouTube | `source_post` |
| D03-W01 Keyword opportunity scan | keyword_list ≤15 | the site's category + products (hypotheses **"to validate in Search Console"**) | Search Console, Shopify | `about_the_business` |
| D03-W02 Content gap analysis | content_gap ≤10 | the site profile (sections vs category norms) | Search Console (+ competitor crawl) | `about_the_business` |
| D04-W01 Lead research & scoring | lead_brief | a target description from the founder — produces the ICP, rubric, research checklist; **no scraping of people** | HubSpot (real rows get provisional scores) | `target_description` |
| D04-W02 Supervised outbound drafts | outreach_draft ≤3 | a lead brief artifact (from D04-W01) or a pasted brief | HubSpot, Gmail | `lead_brief` |
| D04-W03 Meeting brief builder | meeting_brief ≤5 | today's meetings from a calendar / HubSpot, or the founder says who | HubSpot, Gmail | `meeting` (or connect HubSpot) |
| D05-W02 Abandoned cart recovery | email ×3 | **a Shopify store** with abandoned checkouts this week (store only) | Klaviyo | — (not applicable without a store) |
| D05-W07 Campaign calendar prep | calendar ×6 | the goal + plan + what the business sells | Shopify, Klaviyo | `about_the_business` |

The `check` for each lives in its skill file and is unit-tested on fixture accounts
(`src/lib/runtime/__tests__/skills.test.ts`).

## Truth rules (code, not prose)

- **Skill check before any model call.** Missing material → `{ needs }` → `waiting_input`. Never a
  placeholder artifact.
- **Numbers only from the evidence.** `allowedNumbersFrom([profile, memories, reads, inputs, goal,
  plan, prior artifacts, vars])` + counts 0–31 + the current year. Any other number literal rejects
  the reply (the narrative / self-review contract, applied to artifacts).
- **Banned phrases** reject the reply (`src/lib/artifacts/validate.ts` `BANNED_PHRASES`).
- One retry carries the rejection reason; a second rejection ends in an honest ask
  (*"I don't have enough to draft this yet: …"*).
- No model configured / transport failure → the producer **throws** and the run fails closed with a
  receipt. That is an operator problem, not something to ask the founder for.
- Playbooks (≤ 3, by the skill's domain) shape the craft, never the facts.

## The founder's loop

1. A run lands an artifact → Home "What I drafted" shows the card (routine tag, kind chip, title,
   first lines). Open → the body, the items, the evidence.
2. **Approve** → `artifacts.status = approved`, `taste_events(approved)`, memory *"Approved a post
   set from Founder content engine (…)"*. **Hold** → a one-line why → `held` + memory with the
   reason. **Edit** → `edited_body` (the original stays) + memory. **Why?** → `why_opened`.
3. **Copy** (plain text) · **Send me this on Telegram / WhatsApp / Slack** when a channel is linked
   (`POST /api/artifacts/<id> {action:"send", channel}` → `sendOnLink`, kind `draft_landed` — to the
   founder, never outward).
4. `waiting_input` on Run now: the ask renders with an answer box per input; "Send answers and
   draft" resumes from the same panel.

## Follow-ups outside this change

- `src/lib/runtime/availability.ts` (setup agent's file) still gates on **every** read platform, so
  D01-W01 shows "needs Gorgias connected" and `canEnable = false` even though its reads are optional.
  One-line fix: skip `n.optional` reads in `readPlatforms`, or read `spec.minimum.platforms`.
- Calendar has no connector yet; Meeting brief asks for HubSpot or the founder's note until it does.
- Wave-2 routines keep their check → decide chains (they mutate; the produce step is not theirs yet).

## Running the proof

```bash
set -a; source /path/to/.env; set +a          # a provider key — never printed
npx tsc -p scripts/proof/tsconfig.json && node dist/proof/scripts/produce-proof.js
```

Runs the Founder content engine skill through the real `LlmProducer` against a fixture business
profile (no database, no writes) and prints the artifact.
