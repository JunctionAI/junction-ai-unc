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
