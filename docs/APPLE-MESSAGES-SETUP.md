# Junction Apple Messages pilot

Updated 4 September 2026. Status: PARTIAL — Tom subsequently reported that Apple registration was submitted and is under review. This is a user-reported update, not a fresh provider readback. No Apple channel is live.

## Current implementation checkpoint

- Apple is now a distinct channel in the local application. The adapter is deliberately hard-disabled; POST `/api/webhooks/apple` always returns 503 and accepts no events.
- `VerifiedAppleMessage` is an internal normalized contract, NOT an Infobip webhook schema. Business/customer/event IDs are scoped together; they are not phone numbers or app identities.
- Local fixtures cover pairing, account-scoped conversation routing, duplicate events, STOP/conversation closure, and pausing automation when human support is requested. No human assignment or delivery is claimed.
- Proactive Apple notifications are blocked in this preparation. Apple is shown as awaiting setup in the channel picker.
- Migration `20260904023448_apple_channel_preparation.sql` extends existing channel constraints only. It depends on the preceding command-queue migration. Neither migration was applied to the live database in this work.
- Activation still requires approved business/provider IDs, documented authenticated callbacks and delivery/closure contracts, actual human-support ownership, an isolated test identity, in-flight opt-out checks, and real-device end-to-end receipts. An environment flag cannot activate the placeholder adapter.

The historical receipts below are retained as history. Statements about sign-in, missing code and asset preparation in those sections are superseded by Tom's subsequent updates and this checkpoint.

## Historical verified provider setup receipt

After Tom reported he was logged in and asked to set up the rest:

- Infobip authenticated account: tom@getjunction.ai, 60-day trial displayed; no funds added.
- Apple Messages for Business was listed under Available channels (12), with Enabled channels (0).
- Submitted one Apple-channel request for **New Zealand only**, industry **Business software / AI productivity**. Optional volume/additional contacts were left unset; no volume claim invented.
- Provider displayed **Request submitted** and said next steps would arrive by email.
- Independently read back My requests: **1 channel request**, **0 sender requests**; request **f12455d6-7a65-4c88-97e3-34012a472376**, requested by **tom@getjunction.ai**, country **New Zealand**, status **Pending**.
- Receipt page: https://portal.infobip.com/channels-and-numbers/my-requests
- Submitted use case: "Opt-in AI business assistant; NZ internal pilot using our own backend for business-data questions and draft workflows. Human support escalation planned. Please confirm eligibility, test access and costs before any paid activation."
- Submitted content example: "hey, i'm unc, junction's ai assistant 👋 ask me about your connected business or request a draft. i'll ask before any changes go live. type help for support or stop to opt out."
- Apple Business Register → Sign In still shows an empty Apple Account sign-in form. Tom must complete authentication; no Apple organization/test account or Business ID created.
- No API key was revealed/copied, no billing change made, no sender connected, no webhook configured, no code deployed, and no chat message sent. Request Pending is not provider enablement or handset readiness.

Next: Tom completes corporate Apple sign-in; confirm organization identity and test-device Apple Account before registration. Reconcile the existing Infobip request instead of submitting a duplicate. Provider approval, costs and human-support arrangements remain unresolved.

## Decision and current evidence

Target the official Apple Messages for Business channel demonstrated in Tom's Poke screenshot. Do not buy a NZ shortcode for this channel. Infobip is the first provider candidate, not a final commercial commitment: its entry was observed on Apple's approved-provider page, and its documentation describes inbound HTTP forwarding to our own backend. Twilio currently advertises private-beta access, so it is not the first route for an urgent pilot.

Live browser checks: Apple Business Register requires sign-in. Infobip initially required sign-in/registration; after form preparation the page advanced independently to email-confirmation-pending. Codex did not submit the form or accept terms. This does not establish whether Tom already owns other accounts. Infobip's signup supports New Zealand and says no credit card is required, but its free signup does not prove Apple-channel entitlement. Apple support for the proposed AI-assistant use case, provisioning time, pricing, and regional service access still need confirmation.

Account owner: **tom@getjunction.ai**, explicitly supplied by Tom this turn.
Public website: **https://getjunction.ai/**, checked live.
App: **https://junction-unc.vercel.app/app**, supplied by Tom.
Proposed customer-visible name: **Junction**; assistant name in messages: **Unc**.
Legal organization name/address: **Tom must confirm; do not substitute the brand name for a legal entity**.

## Initial account handoff (superseded by latest receipt above)

1. Complete the Infobip confirmation link sent to tom@getjunction.ai and any remaining signup details directly in the browser. The company email and name were prefilled by Codex; final submitted website/terms were not observed. Leave optional marketing consent off. No paid plan, credit purchase, or sales request is approved by this document.
2. Sign into Apple Business Register with a company-controlled Apple Account. If the nominated email is not already an Apple Account, Tom creates it directly; do not change the Apple Account on his phone. The personal Apple Account used on his phone can later be added as a tester.
3. In Infobip, inspect Channels and Numbers → Channels for Apple Messages for Business. If absent, request enablement only after Tom approves the provider enquiry below.
4. Confirm provider use-case acceptance and commercial terms before selecting its endpoint in Apple. Then create the internal test account, verify the provider connection, and add the test-device Apple Account. Public availability requires Apple's subsequent experience/brand review.

## Provider enquiry — DRAFT, NOT SENT

Subject: Junction — Apple Messages for Business, NZ AI-assistant pilot

We're building Junction, a business-growth assistant for business owners, with an initial internal pilot in New Zealand. Customers connect their own business platforms in our app and message our AI assistant, Unc, to ask about their business, request reports or drafts, and manage opted-in routines. We want a Junction-branded conversation in Apple's Messages app. This is an ongoing assistant service, not merely a support chatbot, and it is not unsolicited marketing to consumers.

Our proposed pilot is read-only/draft-only for business actions. We plan to offer human support escalation; the staffing and support hours will be confirmed before launch. We have our own application/agent runtime and want API/webhook integration rather than replacement of that runtime.

Please confirm:

- Whether this use case is eligible for Apple approval through Infobip, including opted-in recurring business briefings.
- Apple-channel availability for a New Zealand organization and NZ Apple-device testers; any regional restrictions.
- Earliest internal-test access and the separate commercial-review process. Please distinguish provisioning from public launch.
- Setup, monthly minimums, message charges, required products/seats, minimum term and whether Apple-channel testing is included in a free trial.
- API access for inbound/outbound messages, provider delivery receipts, authenticated callbacks, retry/replay behavior, and conversation-closed/opt-out events.
- How to bind Apple's customer identifier securely to an existing app account, and how our bot hands off to a human without both replying.
- Data retention, subprocessors and hosting options for potentially sensitive business conversations.

Website: https://getjunction.ai/
Product: https://junction-unc.vercel.app/app
Contact: tom@getjunction.ai

## Integration design — proposed, not implemented

Apple Messages → approved provider → authenticated durable inbox → verified Junction user/business → existing Unc runtime → provider → Apple Messages.

- Add a distinct Apple Messages channel. Do not pass Apple customer identifiers into the SMS adapter or treat them as phone numbers.
- Securely bind the provider sender/Apple Business ID plus customer Opaque ID to a signed-in, owner-authorized app identity. A phone OTP alone is not evidence of that binding. Use a short-lived, single-use authenticated pairing flow; no sensitive context before successful binding.
- Keep existing client OAuth credentials and routine permissions separate from the messaging transport. One customer's messages must never select another customer's connections or business scope.
- Acknowledge durably accepted inbound events promptly; send an honest, short automated greeting/status while slower jobs run. Do not report workflow completion until a result receipt exists.
- Deduplicate inbound events and callbacks; distinguish provider acceptance from delivered messages; reconcile ambiguous sends rather than retrying blindly.
- Support opt-out and conversation closure at provider and application layers, including already queued notifications. Human handoff must pause automated replies until explicitly returned to the bot.
- Launch behind an off-by-default pilot gate, scoped to the approved test user and verified AVGAR account. Keep current production channels unchanged.
- No code/API integration is claimed ready. The existing Channel union has no Apple Messages entry; provider credentials, Business ID, callback contract, pairing, human handoff and end-to-end verification remain work.

## Review packet to complete after access

- Three proposed test flows: explain connected AVGAR data with source/freshness; produce a draft-only routine result; opt into and cancel a business briefing.
- Failure flows: unlinked user, wrong business, unavailable source, duplicate event, failed/ambiguous send, STOP, conversation deletion, and human escalation.
- Actual human-support owner/hours and response expectations must be confirmed by Tom; do not claim a staffed service prematurely.
- Prepare the current approved Junction logo for Apple's specified square asset (1024px minimum, under 2MB, suitable padding) and any legacy wide asset required. No redesign or upload has occurred.
- Confirm public privacy/terms URLs, legal organization details, and planned conversation-data use before submission.
- Record a complete real-device journey for experience review. Successful local mocks, signup and a provider HTTP response are not handset delivery proof.

## Sources checked this turn

- Apple provider list: https://register.apple.com/messages (Infobip link visible in browser).
- Apple setup and experience review: https://register.apple.com/resources/messages/messaging-documentation/
- Apple registration, tester and brand assets: https://register.apple.com/resources/messages/messaging-documentation/register-your-acct
- Apple human support and messaging policies: https://register.apple.com/resources/messages/messaging-documentation/policies
- Apple account identifiers: https://register.apple.com/resources/messages/messaging-documentation/faq
- Infobip channel setup: https://www.infobip.com/docs/apple-messages-for-business/get-started
- Twilio private beta: https://www.twilio.com/en-us/messaging/channels/apple-messages-for-business

## Initial preparation receipt (before authenticated setup)

This turn Codex prefilled the account email/name without accepting terms/submitting, created this setup packet, and marked the prior TNZ recommendation superseded. The page subsequently showed an email confirmation had been sent; no verified account access yet. Codex sent no provider enquiry, purchased no service, generated no credential, submitted no Apple registration, deployed no code, and sent no live chat message. Browser/account state must be rechecked after Tom completes sign-in.
