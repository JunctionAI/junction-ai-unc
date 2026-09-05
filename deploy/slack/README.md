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

## Remaining setup

1. Provision this app's `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET` and
   `SLACK_SIGNING_SECRET` into the exact production app/worker secret stores.
   No secret belongs in this manifest, source control, logs or chat. Production
   Vercel metadata currently has none of these keys. Do not reuse another app's
   secret or copy a Hyperagent workspace token.
2. Release with those settings while retaining all action gates, then verify
   setup-only availability. Validate the signed callback handshake separately
   from listening to customer events; setting env keys is not delivery proof.
3. Owner consent must start inside the signed-in Junction account through
   `/api/channels/slack/start`, not the generic dashboard Install link. Junction
   must create its owner/account/revision-bound nonce before the callback can
   atomically store a verified identity and sealed workspace token.
4. Stage the exact channel with verified owner/membership and provider metadata.
   Finish revision-bound route lifecycle/cutover, then obtain the scoped pilot
   channel/recipient/window approval before changing listeners or sending.

No actual consent, bot token, channel route or Slack message exists from this
setup batch. Token rotation is off in the manifest because the current channel
grant schema does not yet implement Slack refresh-token rotation. Do not turn it
on without implementing and testing that lifecycle; revocation/reconnect and
credential health remain required acceptance checks.

References: [Slack manifests](https://docs.slack.dev/app-manifests/) and
[manifest fields](https://docs.slack.dev/reference/app-manifest/).
