# Replies to paste to contributors

These messages are prepared for Tom to send; Codex has not sent them externally.
Neither contributor branch is merged or deployed.

## Fable

Thanks. Codex located `bb7e2484e81d9ad3485f4cf3c86ee7c09486d7ac` in the local
`junction-unc-avgar` worktree. Please push `claude/avgar-paid-lanes-20260906` to the existing
remote and return the full SHA. Keep corrections in a separate commit; no rebase onto the
changing shared engine yet. Codex owns integration and the paid-ledger migration.

One concrete correction from code review: `cleanCap` currently proves that the returned cap is
half the returned price, but not that the price was independently verified. Bind the product
reference, market, currency, price and source revision to trusted input material. Require HOLD
when that mapping is unavailable. Add a test where a fabricated product price with perfectly
correct 50% arithmetic is rejected. The word "verified" or a provider-supplied product_ref is
not itself price evidence.

Also check the currency restriction: preserve the actual ad-account currency. Do not require
Google Ads billing currency to equal the Unc workspace display currency unless there is a
specific validated reason. Any cross-currency CPA comparison needs a verified conversion;
never compare raw amounts across currencies. Do not add an FX integration in this slice.

Treat D02-W09 as proposed until Codex reviews the catalog mapping. No need to ask Tom for
existing account IDs/currencies yet; Codex will inspect authorised connections first.

Do not change live account pauses, credentials, registrations, release scopes or deployments.
The newer shared saved-schedule path has already executed a keyword test automatically, so
do not introduce another scheduler. Return focused test results, explicitly simulated.
No scope expansion beyond these corrections and the reproducible handoff.

## Grok

Thanks. Codex fetched `1782d38f33bf6541adcc70d8a2c25b3847b5db41`. Keep the branch isolated
and undeployed. Codex will review the actual SQL and rerun the isolated PostgreSQL tests
before applying it; your report is not yet an independent production verification.

Important update: the shared saved-schedule path already exists and ran AVGAR keyword research
automatically, with n8n execution #100 and a Slack result. Do not wire a separate Content
scheduling loop or assume Monday 08:00. Content should reuse that path with customer-selected
timing, switch checks and duplicate protection once its admission adapter is integrated.

Please send the exact frozen receiver request/response examples and authority requirements
for both hooks and questions, so Nguyen can implement without guessing. Mark proposed URLs
versus published workflows explicitly. Fixtures must use golf travel bag with US/NZ/AU
separated. Include exact revision/node metadata required for independent saved-execution
verification. No production SQL, workflow edits, credentials, deployments or live calls.
Email remains deferred. No further scheduler implementation or scope expansion is needed.
