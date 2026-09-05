# Junction Unc Slack application

Setup app created 6 September 2026 in the **Junction AI** workspace
`T0BMD3LMWUQ`: **Junction Unc**, app ID `A0BV96C6BFC`.
[App settings](https://api.slack.com/apps/A0BV96C6BFC).
This is a separate Junction-owned app, not a modified Hyperagent app.

`setup-manifest.json` is configuration only, not proof of installation or delivery.
Its scopes match the runtime's `SLACK_SCOPES`; the unit test rejects drift.
No channel-history/user-token/public-send scope is requested. Direct-message
history and app mentions are requested for the implemented entry points.

## Creation versus installation

Slack's current creation wizard labels the scoped-manifest action **Create and
Install**. For setup without consent, create a shell with only
`display_information` and the disabled settings, confirm **Create Anyway**, then
save this full manifest in the new app's App Manifest page. Bot features without
scopes are rejected by the wizard, so omit both from the shell. Do not repeat app
creation: the app above already exists and its full setup manifest is saved.

Event Subscriptions, interactivity and Socket Mode remain off. The runtime's
messaging and command release gates also remain off. Adding scopes to an
uninstalled app defines future consent; it does not grant access.

## Verified installation — Batch 81

Installed through the signed-in AVGAR owner's Junction flow at
`2026-09-05T23:05:46.814891Z`, not the generic Slack dashboard link. One verified
identity and sealed workspace credential were saved atomically; the install pin
was removed. A fresh worker read using that stored credential returned matching
workspace `T0BMD3LMWUQ`, bot `U0BV96TRXK4`, and the eight expected scopes.

All three app keys are now in Vercel **Production** Secret variables and Fly's
secret store. The bot token lives only in the sealed database credential, not an
environment variable or repository file. Worker release 42 and final app
`dpl_5Bg9bHmN5UPY98D54yaBfBZvQJQM` retain source `781dfe740026`.

The first real attempt caught stale APP_URL/NEXT_PUBLIC_APP_URL values pointing
to the separate marketing site. Their existing shared Production/Preview rows
now use `https://junction-unc.vercel.app`; the website project/domain is untouched.
Never register the marketing site's nonexistent callback to bypass this error.

## Remaining setup

1. Preserve production-only secret provisioning and disabled action gates.
   A source-HMAC synthetic URL challenge passed; it is not a Slack-issued event
   or customer message receipt. Other environments are not configured for this
   app merely because their public origin setting exists.
2. Future owner consent must start inside the signed-in Junction account through
   `/api/channels/slack/start`, not the generic dashboard Install link. Junction
   must create its owner/account/revision-bound nonce before the callback can
   atomically store a verified identity and sealed workspace token.
3. Stage the exact channel with verified owner/membership and provider metadata.
   Finish revision-bound route lifecycle/cutover, then obtain the scoped pilot
   channel/recipient/window approval before changing listeners or sending.

Actual consent and the stored-token read now pass, but no channel route or Slack
message exists from this setup batch. Token rotation is off because the current channel
grant schema does not yet implement Slack refresh-token rotation. Do not turn it
on without implementing and testing that lifecycle; revocation/reconnect and
credential health remain required acceptance checks.

References: [Slack manifests](https://docs.slack.dev/app-manifests/) and
[manifest fields](https://docs.slack.dev/reference/app-manifest/).
