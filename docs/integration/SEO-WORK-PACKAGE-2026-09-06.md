# Coordinated SEO work package

Status: planner implemented and locally tested; not connected to live dispatch, persistence or UI.
This is not proof of article production or CMS implementation.

## Customer outcome

One saved cycle per account, context generation and market. Selected routines share
research and produce one reviewable set of page improvements and article drafts.
The customer sees what is prepared, why it matters, and exactly what still needs access.
Research completion is not website implementation. Publishing remains separately gated.

## Implemented seam

`src/lib/runtime/seoPackage.ts` reconciles selected steps and saved result references.

- Keywords feed both content-gap planning and on-page edit preparation.
- Gap planning feeds article drafting only when article preparation is explicitly selected.
- Competitor, AI-visibility and performance observations remain separately labelled inputs.
- Off prerequisites block dependants; the planner never turns a switch on.
- Source results must match account, generation, market and cycle, and remain fresh.
- Downstream results bind exact source artifact IDs and revisions. Editing research invalidates
  dependent work rather than presenting the old draft as current.
- One reviewed intent cluster has one proposed page owner. An existing page takes precedence
  over another article for the same intent. Conflicting page owners need review.
- There is no publishing function and no provider call in this module.

IDs are the current repository mappings, not the department IDs in generic reference skills.
D03-W04 is page title/description editing, NOT article writing. No catalog ID has been invented
for article production. D03-W07 backlinks remain outside the executable catalog.

## Remaining implementation, in order

1. Persist a package with its selected routine revisions, market, cycle and explicit article
   preparation choice. Accept result references only through trusted saved-run/artifact reads;
   never accept `results` or adapter readiness directly from a client request.
2. Reuse the existing saved-schedule and run-admission paths. Resolve a ready step once,
   atomically claim it, and recheck switch, account generation, adapter pin and permission at
   dispatch. The planner itself is NOT a lock, execution receipt or authorization boundary.
3. Adapt verified keyword output into the package. Page inventory and gap observations must
   have their own provenance; keyword text alone cannot prove that a page is missing.
4. Build the draft-only article capability and page-edit preparation adapter. Consume the exact
   research references; save full drafts, current/proposed edits and proposed internal links.
   Do not infer product claims or target URLs from a keyword. Missing inventory blocks page
   ownership decisions; missing CMS write access need not block researched draft preparation.
5. Render a single review with links to its actual saved artifacts and clear blocked steps.
   Approval binds the exact package/artifact revisions; editing any output invalidates approval.
6. Only then add separately authorised CMS implementation and independent readback. Monitoring
   must distinguish DataForSEO snapshots from Search Console statistics.

## Acceptance proof

One AVGAR cycle creates no duplicate research calls or duplicate intent articles, survives a
worker retry, respects a mid-run disabled switch, isolates US/NZ/AU, produces real drafts based
on observed site/product context, and returns one plain-English review. No publishing without
an exact approval. This end-to-end package test is still outstanding.

Local planner tests: 17 passing. App and worker TypeScript checks pass.

## Saved-result readback and conversational status

Added `seoSavedResults.ts`: reads the actual saved run and artifact, verifies account,
generation, routine, kind, run completion, spec hash, artifact revision and held status.
Bindings must originate from the trusted package controller, not a request body. It refuses
article completion until an actual producer mapping exists. Storage errors propagate rather
than being disguised as no work. No database migration or provider call was made.

Added `seoConversation.ts`: concise lowercase status messages, no routine IDs, no extra model
call, no claim that a ready step has started. Missing work is described alongside completed
work. The existing command result reply also gets conversational singular/plural wording.

These helpers are locally tested together using a fake Store; they are not yet connected to
the live package controller, scheduler, review UI or Slack package notifications. The existing
keyword command reply change also requires a worker deployment before users receive it.

## September 6: real source and draft pilot

- Fixed a real storefront-reader failure: 60 KB truncated AVGAR's HTML inside a reviews
  script, and the extractor treated the unfinished script as page text. Unclosed script/head
  content is now removed. SEO opts into a bounded 1 MB fetch, with the same DNS-pinned guard.
- Added `seoSources.ts`: a maximum of six same-origin observed pages; main content instead
  of navigation/country-selector noise. Not a complete crawl or proof of missing pages.
- Added `seoDraft.ts`: bounded draft-only model call, existing-blog revision, existing-page
  metadata proposals, internal links restricted to observed pages, source references, source
  freshness, account/generation checks, current/proposed metadata. No publication code.
- `scripts/seo-draft-pilot.mjs --run-once` is an explicit operator test, NOT a scheduled app
  feature. It independently reads the saved keyword run and verified permit, validates the
  stored execution receipt's market/domain/seed, then reads the public site and uses the
  existing budgeted model router. Outputs stay local and gitignored.
- Real keyword source: artifact ea33a35b-5c1f-4b70-8678-18e56ac86621, execution 100, US.
- Real source read found the Uforia product page and an existing golf travel case guide.
- Initial real draft was rejected on human review for overlapping intent and unsupported
  comparison claims. Subsequent model response was retained; replay validated it without an
  additional model call after whole-response JSON-fence handling was fixed.
- Validated local result: one existing-guide revision and three metadata proposals. This is
  a draft preview, not customer-ready copy: it still needs brand-voice editing and factual
  review. Local artifact path: artifacts/seo-pilot/2026-09-06T04-10-10-598Z/REVIEW.md.

Still NOT implemented: durable package job/controller, saved-schedule invocation of the
package, in-app package review, Slack package notification, approval-bound CMS execution,
and complete multi-market/multi-routine rollout. No live deployment or DB mutation in this
pilot. Do not describe the whole SEO employee as working from these draft results.
