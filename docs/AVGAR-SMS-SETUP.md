# AVGAR: Unc on your phone

> Superseded as the primary phone-channel recommendation on 4 September 2026 after Tom demonstrated Poke's verified Apple Messages conversation. Follow [APPLE-MESSAGES-SETUP.md](APPLE-MESSAGES-SETUP.md) for the Junction-branded Apple pilot. Do not purchase or activate TNZ for this request. The SMS implementation and receipts below are retained as historical work and a possible separately approved fallback.

## Recommendation and cost (checked 4 September 2026)

Use **TNZ Starter + a dedicated six-digit, free-to-text NZ short code** for Unc. Junction owns the messaging account and Unc number; each founder links their own phone to their business in Unc. Do not buy a separate code for every client. This implementation is deliberately restricted to one AVGAR account and one phone until tested.

TNZ publishes NZ$299 setup, NZ$89/month for the code, and a NZ$20/month Starter plan: budget NZ$109/month plus GST and usage, subject to a confirmed quote. Free-to-text usage is 10c per outgoing and incoming SMS part. Emoji/Unicode and long messages can cost multiple parts. Provisioning is approximately four weeks. Do not commit to a subscription until TNZ confirms this use case and the total quote.

Sources:
- https://www.tnz.co.nz/Resources/Article/nz-6-digit-sms-short-codes-now-available/
- https://www.tnz.co.nz/Services/Pricing/
- https://www.tnz.co.nz/Services/SMS/APIs/

Comparison: WebSMS lists a six-digit code at $350 setup/$85 monthly; its full API/security and platform-fee terms need a quote. Twilio already has an adapter here, but its NZ guidance lists 5–6 weeks for dedicated codes and warns that international sender IDs are not preserved. TNZ is the recommended fit based on explicit NZ customer-initiated inbound support, published v3.00 contracts and transparent pricing, not a claim that every carrier has been tested.
- https://websms.co.nz/pricing/
- https://www.twilio.com/en-us/guidelines/nz/sms
- https://help.twilio.com/articles/235288367-Receiving-Two-Way-SMS-and-MMS-Messages-with-Twilio

An overseas number can send to an NZ phone; it is not a dependable substitute for always-available two-way NZ conversations. TNZ's instant shared numbers are recent-reply-only, so they do not support this pilot's user-initiated link-code flow. The signed-in mobile web app remains usable during number provisioning; no claim of SMS readiness until the carrier test passes.

## What Tom needs to do

1. Start a TNZ trial from https://www.tnz.co.nz/Services/Pricing/ using Junction's business account. Tom completes terms, billing, verification and credential entry; no purchase or signup has been performed by Codex.
2. Send TNZ this request (draft only, not sent):

   > We're building Unc, an opt-in AI business assistant. A business owner logs into our app and links their own NZ mobile, then texts Unc for business questions, draft-only workflow requests and approval discussions. This is not a bulk customer marketing campaign. Please quote one dedicated six-digit **free-to-text** NZ short code on Starter, with customer-initiated inbound messages at any time, SMS send API v3.00 and JSON inbound webhooks. Please confirm all supported NZ networks/MVNOs, lead time, total setup/monthly/per-part costs including emoji handling, STOP/HELP behavior, and that this API user always sends from the assigned code. Please confirm the exact Authorization, X-Sender and X-Timestamp callback contract, timestamp behavior on retries, and retry policy. Can you provide an isolated test code while our dedicated code is provisioned?

3. Once approved, TNZ Dashboard → Users → select/create an Unc API user → enable API access → API tab → enable/create Auth Token. Put it directly into Vercel's secret environment configuration, never chat or Git. Ask TNZ to assign the dedicated Unc code to that API user; setting `FromNumber` alone is insufficient in NZ.
4. Tell the developer which signed-in AVGAR account and which personal +64 mobile to restrict the pilot to. The actual account ID must be read from the authenticated app/database, not guessed from a name. These have not yet been verified for deployment.

## Developer activation checklist

Configure these server-only values in the app and recovery worker:

| Variable | Value |
|---|---|
| `SMS_PROVIDER` | `tnz` |
| `TNZ_AUTH_TOKEN` | Secret TNZ API token |
| `TNZ_WEBHOOK_AUTHORIZATION` | Secret **complete** expected Authorization header, confirmed by TNZ; public spec illustrates `Basic <JWT>` |
| `TNZ_SENDER` | Exact TNZ API user email / X-Sender |
| `TNZ_FROM` | Assigned dedicated 4–6 digit code, no +64 prefix |
| `TNZ_PILOT_ACCOUNT_ID` | Verified AVGAR account UUID |
| `TNZ_PILOT_PHONE` | Tom's confirmed +64 mobile, E.164 |
| `TNZ_SMS_ENABLED` | Leave `false` until provisioning, schema, code deployment and recovery worker checks pass; then explicitly activate with `true` |

No browser-exposed secret variables. Unknown providers fail closed; selecting TNZ never silently falls back to Twilio. The pilot adapter refuses all other phones/accounts and unverified links, including proactive messages. To roll back, set `TNZ_SMS_ENABLED=false` on app and worker and redeploy/restart. Do not rotate a shared token without checking TNZ's webhook and API requirements.

TNZ Dashboard → Users → API → Reporting: inbound SMS callback = **POST JSON** `https://junction-unc.vercel.app/api/webhooks/tnz`. Use the official v3.00 inbound schema, not the legacy GET shortcode API. The receiver requires the exact secret header and sender plus an RFC3339 timestamp within five minutes. It does not trust body `APIKey` as a signature. Validate a real callback before activation; if TNZ cannot supply this contract, keep disabled and resolve it with support, never remove authentication.

Apply/review the existing `20260904011301_routine_command_queue.sql` migration against the correct Unc project: TNZ ingress depends on its service-only `channel_inbox` table. Do not blindly apply every pending migration. Deploy the reviewed code and run the existing worker with matching configuration; incoming messages trigger an immediate Vercel `after()` drain, and the worker recovers queued messages on its next tick. `UNC_COMMANDS_ENABLED` can remain off for conversational testing. Enable routine dispatch only after its own migration/worker/provider acceptance checks in `COMMAND-DISPATCH.md`. Business execution remains draft-only.

The immediate drain is bounded by a 60-second function duration. Interrupted/failed claims become `uncertain` rather than automatically replaying possible sends. Monitor `channel_inbox` queued/running/uncertain and the outbound ledger. Retention, durable SMS usage caps and wider customer activation remain rollout work. Configure a low TNZ credit limit for the single-phone pilot; Unc's model budget does not include carrier charges.

## Phone acceptance test

1. Log into https://junction-unc.vercel.app/app on your phone and open the **AVGAR** business, then **Channels → Text**. If setup is incomplete the choice stays disabled with an honest explanation.
2. Tap **Open Text** and send the displayed one-time `UNC-…` code from your confirmed phone. It expires after ten minutes. This links the phone; it does not access the phone's other SMS conversations. For now one phone has one active business.
3. Receive Unc's lowercase welcome and see the app mark the link verified. Save the shortcode as **Unc**.
4. Text “what do you know about AVGAR?” Check real account context and the shared app conversation. No model tone or business-data accuracy has yet been validated live.
5. With command dispatch separately enabled, request one agreed read-only/draft routine; verify queued/running/result states, correct account inputs and no external business mutation. A switched-off routine must remain blocked.
6. Text **STOP**: the app link is deleted and no model or business decision is invoked. Confirm TNZ's provider opt-out/HELP behavior. Re-link from the app only after restoring provider opt-in as instructed by TNZ.
7. Confirm the actual received sender code, inbound event ID, provider submission ID, TNZ delivery status and app-thread row. An HTTP 200 or local mock is not handset delivery evidence. The current outbound ledger's `sent` means provider acceptance, not carrier delivery; consult TNZ's delivery report for that proof.

## Implementation boundaries

- Implemented: selectable TNZ transport, strict pilot restrictions, authenticated/bounded JSON ingress, durable dedup before ack, immediate + worker processing, owner-bound linking, cross-account rejection, SMS voice and SMS STOP disconnect.
- TNZ supports 1000-character message bodies. This adapter refuses overlong messages instead of truncating essential information. The full reply remains in the app with a failed-delivery record; no automatic resend after ambiguous submission. Provider template markers `[[...]]` are refused to prevent server-side content expansion.
- Not performed: signup, purchase, secret entry, migration application, Git push, deployment, real SMS or live AVGAR workflow execution. No delivery callback endpoint is exposed; inspect TNZ delivery reports during the pilot.
- Shared-token webhook authentication is not a signed payload protocol. Require HTTPS and an isolated API user; review a stronger provider-supported scheme before expanding the pilot.

Official API: https://www.tnz.co.nz/docs/restapi/contents/3.00/3.00.yaml

## Local verification receipt

- Full suite: 164 files / 1,951 tests passed, including TNZ transport, authenticated ingress, durable dedup, tenant/phone restrictions, session-bound channel setup, opt-out keywords and normal six-letter chat messages.
- App and standalone-worker TypeScript checks passed; production build passed with `/api/webhooks/tnz` included.
- Targeted lint: zero errors, two pre-existing component warnings (Slack navigation and mascot image).
- No handset, carrier or authenticated AVGAR account acceptance test has occurred. Live activation remains blocked on the setup items above.
