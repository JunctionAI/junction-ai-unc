# Keyword reviewed-revision release

Batch 64. This is future admission for the independently reviewed Nguyen handoff,
not a relabelling of the four historical provider runs or proof of a new run.

## Change and safety boundary

- New allowed revision: `ac771cd3-8899-4401-915c-40d4477e48e2` on existing wrapper
  `XiXJKuph1fAeH9pe`; [independent review](integration/NGUYEN-FINAL-REVIEW-2026-09-06.md).
- Previous revision `92135add-3c35-43e4-9649-5bb3d4557814` remains on historical
  permits, receipts and the saved disabled customer recipe. New admission and
  completed-recipe selection require the reviewed revision. Old proof cannot
  become a new-revision candidate by changing its label.
- Migration `20260905193007_keyword_reviewed_revision.sql` requires original
  AVGAR owner/context, paused account, no enabled routine/draft or unresolved
  work. It locks account, registration and controls, checks eight independently
  read function-body hashes, and replaces only reviewed revision/error literals.
  Function owners, invoker status, search paths and grants must remain identical.
  It changes no account, registration, recipe, run or permit row.
- Those eight functions' intentional business-conflict raises now use PT409,
  avoiding the demonstrated PostgREST 40001 retry trap. Genuine PostgreSQL
  serialization errors are not replaced. Configuration HTTP maps either code
  to 409 during rollout. Other business-conflict functions need a separate audit.
- No n8n workflow change, provider run, permit issuance, switch enablement,
  publishing, customer message, ad mutation or spend activation is included.

## Verification before release

- 226 test files / 3,017 tests, app and worker typechecks, production build,
  focused ESLint, verifier syntax and diff checks pass.
- Isolated PostgreSQL command verification passes 22 checks, including actual
  migration guards, unchanged historical rows/recipe, exclusion of old proof,
  concurrent one-winner admission/start and switch/identity/market boundaries.
- Isolated configuration verification passes 18 checks, including completed
  recipe selection, concurrent save PT409, owner/context isolation and grants.
  This smaller fixture uses the exact resulting configuration function body;
  the command verifier above applies the complete actual migration.
- Live preflight at `2026-09-05 19:36:49.341379+00`: AVGAR generation 1, paused,
  zero enabled routines, four verified old-revision permits (executions 77–80).
  Row fingerprints: states `10856e6c3c1252060c37401e87614694`, permits
  `40cf6c28af31a287019dba57276444e3`, runs `59ba6ec4c9b98be57ec4912724cc2766`,
  registrations `ffde846b0ff9c337f3fe2852cca59375`. All eight live predecessor
  function hashes match and deny anon/authenticated execution.

## Release status

Source verified; migration and app/worker rollout pending at this checkpoint.
The release-specific worker checker tests actual compiled pin/configuration,
prompt HTTP conflict refusal, paused issuance rejection and preserved history.
It deliberately supplies an incomplete invalid issuance payload, never an
executable approval. It expects no new live proof and must not be reused as a
generic readiness check after a fresh pilot.

Next: apply/read back migration; release matching app/worker; verify deployed
configuration and history. Then prepare the genuinely authorized bounded
US/NZ/AU run context. New customer selection remains unreleased until that proof.
The full B01–B24/all-client launch goal stays active.
