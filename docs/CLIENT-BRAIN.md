# The Client Brain — what Unc remembers, how it learns, and who is in charge of it

The brain is the per-account memory that makes Unc's replies, briefs and decisions specific to
*this* founder rather than generic marketing advice. It is built on migration
`supabase/migrations/0010_client_brain.sql` and lives across a few modules:

| Piece | Where | Owner of this doc's section |
|---|---|---|
| Memories (write/read/forget/revise) | `src/lib/intake/memoryWriter.ts` (small local writer) · `src/lib/brain/memory.ts` (full brain: extraction, embedding, retrieval) | this doc |
| Intake (n8n) | `src/lib/intake/**`, `src/app/api/intake/**` — docs/N8N-INTAKE.md | this doc |
| What Unc knows (UI + API) | `src/components/platform/WhatUncKnows.tsx`, `src/app/api/brain/{memories,profile}` | this doc |
| Playbooks (Junction expertise) | `content/playbooks/**`, `src/lib/brain/playbooks.ts`, `scripts/import-playbooks.ts` | this doc |
| Chat evals | `src/lib/eval/chat-evals/**`, `scripts/eval-chat.ts` | this doc |
| KPI snapshots, profile learning, daily brief, taste | `src/lib/brain/{kpi,profile,brief,taste}.ts` — docs/PROACTIVE.md | the brain agent |

## Founder-trust rules (these win over everything else)

1. **The founder is the source of truth.** Anything Unc has learned can be seen, corrected or
   forgotten by the founder at any time (What Unc knows). A founder edit creates a memory with
   `source='founder'` and `confidence=1.0` that supersedes the old one; the old row is kept with
   `valid_to` set and `superseded_by` pointing forward. Nothing is hard-deleted.
2. **No invented numbers.** A figure Unc states is in the account context or it is "not measured
   yet". Memories carry facts and preferences; numbers come from `kpi_snapshots` and the live
   context, never from memory. Playbooks are methods, never a source of numbers.
3. **Propose, approve, receipt.** Memory changes how Unc proposes; it never lets Unc act. Every
   consequential action still goes through the approval spine.
4. **Confidence is honest.** Structured intake → 0.9; free text → 0.6; extracted from chat → what
   the extractor says; founder-stated → 1.0. The UI says "I'm not certain of this one" under 0.8.
5. **Isolation.** Every memory row carries `account_id`; RLS (`member_all`) isolates accounts and
   every route still pins `account_id` in its query. Intake writes with the service role but only
   to the key's account. Playbooks are global (Junction's, not a client's) and contain no
   client-confidential material — the content test rejects client names.

## Memory kinds and sources

`memories.kind`: `fact` · `preference` · `constraint` · `decision` · `relationship` · `event`
(with `happens_at`) · `lesson` · `summary`.
`memories.source`: `chat` · `onboarding` · `scan` · `receipt` · `self_review` · `intake` ·
`founder` · `brief`.

What Unc knows groups them: Preferences & constraints first (they shape every reply), then
Facts (+ summaries), People (relationships), Upcoming (events), Lessons, Decisions.

Every row: `text`, `confidence` (0–1), `importance` (1–5), `tags`, `source_ref` (the chat message,
run or intake event it came from), `valid_from`/`valid_to`, `superseded_by`, an optional
`embedding` (1536 dims). Dedupe is on normalised text among the account's live rows.

## Retrieval and personalisation (summary — details in the brain modules)

- **Retrieval**: `match_memories(account, embedding, count, kinds)` does cosine search over live
  rows with embeddings; a keyword path stands in when there is no embedding. Preferences and
  constraints are always loaded; facts/relationships/events are recalled by relevance to the
  question; upcoming events by date.
- **Personalisation** (`account_profiles`): `tone`, `decision_style` and `cadence` are learned
  from taste events and chat; `founder_notes` is the founder's own "How to work with me" text and
  is read before every brief and reply. Learned fields are never overwritten by the founder's
  route; the founder's notes are never overwritten by learning.
- **The prompt**: the chat system prompt appends the recalled memories and the founder notes
  under the account context, and (once wired) the playbook block below.

## Intake (n8n)

`POST /api/intake` with a bearer intake key writes memories (kind mapped per field), merges the
business profile and resource profile, inserts a goal only when none exists, appends team members,
hints connectors (`status='disconnected'` + `external_ref`), and records an `intake_events` audit
row. Idempotency-Key replays. Full contract, n8n node and the self-serve form sketch:
docs/N8N-INTAKE.md.

## Playbooks — Junction's expertise as retrievable cards

`content/playbooks/<domain>/<slug>.md` — frontmatter `domain` (email · paid · seo · content ·
sales · strategy · analytics), `title`, `tags`, `source` (the Junction skills card it was distilled
from) and a body of Junction's *method*: no client names, no client figures. Imported by
`scripts/import-playbooks.ts` into the global `playbooks` table (unique on `(domain,title)`),
embedded with `text-embedding-3-small` (1536 dims) when `OPENAI_API_KEY` is set, otherwise
stored without a vector.

```
npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/import-playbooks.js --dry-run
set -a; source .env.local; set +a   # NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, OPENAI_API_KEY
npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/import-playbooks.js
```

Recall (`src/lib/brain/playbooks.ts`): `recallPlaybooks(query, domains?, limit?)` embeds the query
and calls `match_playbooks`; when no key is set or no card has an embedding yet, a keyword ranker
over title + tags + body stands in. `renderPlaybooksForPrompt(playbooks)` returns the block a
system prompt appends — its header tells the model these are methods, not numbers.

**The one-line call for the chat/decision prompts (not wired yet — `src/lib/unc/prompt.ts` is the
brain agent's file):**

```ts
const playbookBlock = renderPlaybooksForPrompt(await recallPlaybooks(question, undefined, 4));
// … then: `${buildUncSystemPrompt(context, surface)}\n\n${playbookBlock}`
```

Coverage today (38 cards): email flows and campaigns (welcome, cart/browse, post-purchase +
replenishment, cadence, segmentation, copy gate, flow QA, winback/sunset); Meta structure, creative
testing + scaling, attribution ladder, ad copy; Google Ads on thin volume, PMax + feed hygiene;
drop/scarcity paid; creative compliance gate; SEO keyword tiers, technical baseline, AI-search
visibility, newsroom/PR; hook writing, short-form scripting, organic social, media-company system,
conversion copy, copy taste gate; B2B pipeline rhythm, outbound signal sourcing, CRM hygiene; the
weekly ASXR cycle, four-level channel analysis, measurement truth audit, learning extraction; the
Junction method, goal engine, campaign planning, inventory clearance, and the propose/approve/
receipt operating rules.

## Chat helpfulness evals

Twelve-plus golden scenarios (`src/lib/eval/chat-evals/scenarios.ts`) on a fixture account
("Acme Co": brand-led, Writing + Email strengths, NZ$3,600/mo, 8 h/wk, slightly behind a
NZ$60,000 MRR goal, Klaviyo expired, one paid approval pending) cover: pace with real numbers,
missing baseline, "just do it" (must propose, not act), what's running this week, a connector
needing reconnect, an order count the context lacks, a plan challenge, a budget question,
onboarding pushback, a creative ask, ROAS with no paid connected, explaining the pending approval,
a guarantee request, identity, and an industry benchmark the context lacks.

Rubric (`rubric.ts`): the deterministic half — banned phrases, numbers-only-from-context (context ∪
the founder's question ∪ counts 1–12, "60k" read as 60000), no markdown / exclamation marks /
emoji / walls of text — runs in `npm test` with fake completions. The judged half scores 0–2 on
grounded · specific · in_voice · actionable · honest via the `eval_judge` task (default
Sonnet 5; env `LLM_MODEL_EVAL_JUDGE`):

```
npx tsc -p scripts/brain/tsconfig.json && node dist/brain/scripts/eval-chat.js [--only id] [--no-judge]
```

It runs each scenario through the real `buildUncSystemPrompt` + the `chat` task, prints a table and
writes `design-reference/evals/chat-<date>.json`. With no provider key it says so and exits 0.

## What improves over time

- **Memories accumulate and get corrected.** Every chat turn, onboarding answer, site scan,
  receipt, self-review and intake adds rows; the founder prunes and fixes; superseded rows keep
  the history. Retrieval quality rises with embeddings and with the founder's corrections
  (founder rows are 1.0 and win ties).
- **The profile sharpens.** Approval rate, decision latency, what gets held, tone preferences —
  learned from taste events, so proposals get fewer and better shaped for this founder.
- **Playbooks grow.** New Junction skills cards become new playbook files; re-running the import
  re-embeds changed bodies. Lessons written by the self-review become `lesson` memories per account
  and, when general, new playbooks.
- **Evals keep the voice honest.** New failure modes become new scenarios; the deterministic
  rubric is the CI floor, the judged run is the weekly bar, and both are versioned in
  `design-reference/evals/`.
