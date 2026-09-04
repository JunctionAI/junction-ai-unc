# Unc SMS pilot — 2026-09-04

Status: local implementation, not deployed or delivered to a phone.

## Voice

Inspired by the friendly text-first experience at https://poke.com/ and Tom's explicit direction: lowercase conversational prose, simple short replies, occasional emoji. This is Unc's own voice, not Poke's hidden prompt or identity.

The verified inbound SMS channel selects `voice: "sms"` in the shared response pipeline. App and other channels keep their existing voice. The SMS prompt preserves all approval, connector, budget and source-truth rules; it replaces the conflicting default no-emoji presentation rule. Greetings and model-unavailable replies have SMS-specific templates. No blanket lowercase post-processing: URLs, IDs, codes, quotes and artifact content must remain intact. Structured command and approval receipts currently retain their existing deterministic wording.

The same profile applies to a concision retry. The 240-character target is guidance, not an enforced one-segment guarantee. Emoji can select Unicode encoding and increase billable segments: https://www.twilio.com/docs/glossary/what-sms-character-limit. Existing 1500-character transport clipping remains unchanged; review long approval messages before broad rollout.

## Live readiness observed

The connected Vercel API identifies `junction-unc`, project `prj_WXwCzYpwmx9MmLBgqGrpWh8jnc6d`, with a READY production deployment and the `junction-unc.vercel.app` domain. The authenticated project's Environment Variables UI lists neither `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` nor `TWILIO_FROM`; its Shared tab says no shared variables are linked. Values were not revealed. No SMS sending number or destination ownership has been verified.

## Pilot gate

1. Select an existing Twilio account and inbound-capable SMS number; obtain approval before purchasing anything. Enter credentials through the secure configuration workflow, never chat or source control.
2. Configure the exact signed webhook `https://junction-unc.vercel.app/api/webhooks/twilio` and matching `APP_URL`; deploy the reviewed SMS changes. Do not implicitly ship the other uncommitted command-dispatch changes, apply its migration or enable its flag.
3. Tom signs into Unc → Channels → Text and sends the one-time code from his own phone. No manually invented verified link.
4. Test an ordinary greeting and account-context question, check the actual received language, verify the provider message ID/status and app-thread record. Configuration or mocked tests alone are not delivery proof.
5. Test a blocked request and any approval flow only within an explicitly agreed draft-only test. No customer sends, publishing, spend or routine activation from this pilot.

Automated tests cover SMS prompt selection, unchanged app voice, retained authority rules, exact token preservation, inbound channel propagation, welcome and fallback. Live model style and carrier delivery still need the pilot.
