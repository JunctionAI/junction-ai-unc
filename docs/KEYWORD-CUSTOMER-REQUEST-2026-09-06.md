# Customer keyword request — 6 September 2026

The keyword detail screen now uses the shared command queue, not `/api/routines/run`. The request remains read/draft-only; no new provider or action executor is introduced.

`POST /api/routines/keyword-request` accepts only an original UUID, reviewed market, version 2 and exact displayed settings timestamp. Session owner, account/generation/actor headers, canonical stored recipe, verified market evidence, release scope, enabled switch, connector requirements and budget are checked server-side. A changed recipe/registration is refused before enqueue; the worker and existing database permit checks repeat their checks before provider work. No model call is needed for the button's exact `/run D03-W01` instruction. Plain-language chat retains the shared dispatcher.

`GET` resolves the original request UUID to the same account/owner/channel command ID. Reads remain available when paused or commands are off. Saved commands are returned without replay; missing records are unknown, not proof nothing happened. Terminal command status alone does not unlock a new request while its provider permit is unresolved.

The browser stores identity plus displayed configuration before POST. It does not store credentials or outputs. Double clicks/pending journals cannot create a second identity; lost replies are recovered by GET only. A positive pre-queue refusal clears its journal; an unknown/lost response retains it. A late response after account/actor/generation change is discarded. Completed/definitely refused work permits an explicit new request, not automatic retry.

Verification before release: 214 unit files / 2,747 tests pass (24 new request tests); app/worker typechecks pass; focused lint has no errors and the existing RoutineDetail image warning. Thirteen isolated browser checks pass across configuration and request controls, including mobile/desktop, lost response, reload, unreadable storage and context switching. Existing real PostgreSQL command/configuration verifiers and CLI pilot/preflight tests are rerun separately. These fixtures do not prove customer execution against live n8n.

Declared `zod` as exact production dependency `4.5.4`, matching the validation package used by the tests. Previously the local tree could resolve it without a direct production declaration. Lockfile updated; npm audit reports zero vulnerabilities.

Release gate: build a clean committed source checkout, create a production-configured Vercel candidate without assigning domains, build/push a worker image without replacing the running machine, then verify and release the same artifacts with command/external-action flags off. Exact pilot scope and signed-in acceptance remain a separate supervised step. Full B01–B24/all-client acceptance and Nguyen output corrections remain outstanding.
