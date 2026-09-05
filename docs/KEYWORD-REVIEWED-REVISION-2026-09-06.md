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

Migration applied as production history `20260905193727_keyword_reviewed_revision`.
At 19:37:41 UTC and again 19:41:18 UTC, all four row fingerprints above remain
identical. Eight function readbacks preserve invoker/grants/owner/search path;
the three admission/configuration pins are new and none retains intentional
40001 raises. Security advisors remain 19 INFO / six pre-existing WARN notices.

### Deploy result

- URL: https://junction-unc.vercel.app
- Target: production; status READY/promoted.
- Source: `aa3fba419a1cbb8d5a1d4c27dbb363bc3626f92a`, independently pushed/read back.
- Vercel: `dpl_2nmd4t7GiyKmbRubE7MEzbLv4Xef`; Next 16.3.4, build 29 seconds.
  Candidate https://junction-h2n8o7n8f-tom-junctionmedis-projects.vercel.app passed
  health/build/DB and anonymous keyword-configuration HTTP 401 before promotion.
- Fly: release 38, sole Sydney machine `1857466fd76998`, image
  `sha256:f8e2e6b08d8da299594e7c0ef80be51455597320c56d4fbfe11c6c8b658abcaf`,
  tag `deployment-01M1SH7T64YSFNNT26HGE6FCMF`. Actual machine source matches;
  all five external-action flags remain false.
- Canonical health at 19:40:09 UTC reports `aa3fba419a1c`, healthy DB,
  fresh worker (27 seconds old), no worker error.
- The deployed worker check at **19:41:03.720 UTC** passes: exact compiled pin,
  RPC returns no new recipe candidates, shared command admission rejects the
  old saved recipe, stale-context HTTP 409 in **25 ms**, paused issuance HTTP
  409, four historical verified permits unchanged. Five DB calls, no writes,
  provider or n8n calls. Intentionally incomplete invalid issuance payload is
  not an executable approval. This release-specific checker must not be reused
  as generic readiness after a new pilot.
- Initial verifier failed because it imported the app-only customer-view module
  from the standalone worker, which intentionally excludes it. Fixed the checker
  to use the actual shared compiled admission predicate; no runtime change was
  needed. Customer-view verification was performed on the real signed-in app.
- Signed-in Agents → SEO → keyword inspector: saved old run/receipts/draft still
  load; market setup says Not configured, no verified configuration, empty
  selector and disabled Save; Run and switch remain disabled. No settings changed.
  The old draft still displays its historical wording; it was not overwritten.

### Post-deploy observability

- Error/fatal scan for this exact deployment over the last ten minutes returned
  no entries. This is bounded observation, not proof of ongoing alert delivery.
- Authenticated `/v1/drains` returns an empty list. Zero drains; ongoing alert
  delivery and broader monitoring gaps remain tracked in the full register.
- Rollback reference: previous app `dpl_9QB6yhzc1D7aztoEwDvofKZwbiLy`, worker 37
  at `2b4bcfbe5f364b170029f179e4aa124c9518e1f8`. Keep account paused if rollback
  is required; an old app/new SQL pin is not an executable configuration. Never
  restore the intentional 40001 retry trap or relabel historical receipts.

Next: prepare the genuinely authorized bounded US/NZ/AU run context on this
reviewed revision; independent live results can then supply new customer market
choices. No fresh allowance has been opened or old approval extended here.
Native calendar binding/receiver, other lanes and the full B01–B24/all-client
launch goal remain open; this release does not establish customer readiness.
