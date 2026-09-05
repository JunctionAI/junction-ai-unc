# Channels — Unc on Telegram, WhatsApp, Slack and text (2026-09-02)

> Historical design document. For current Slack setup, authority, routing and
> release truth use [Junction-owned Slack runtime](integration/JUNCTION-OWNED-SLACK-RUNTIME.md)
> and [the setup-only manifest](../deploy/slack/setup-manifest.json). Do not apply
> the old manifest below: its metadata scopes are incomplete and it activates
> listeners. Installation no longer sends a welcome, moves an identity between
> client accounts, or permits customer messaging. Conversation history is now
> audience-scoped; the historical whole-cross-channel-history claim below is not
> the current security contract.

**Founder direction:** *"Unc guides you every step of the way; the UI supports it. Connect Unc on the platform you want — Slack, Telegram, text message — and the in-app corner chat is the same conversation: anything said there is pulled across. Approvals and feedback flow through both."*

Unc's line for it, used everywhere in the UI: *"Wherever you talk to me, it's the same conversation — and every decision still lands in the app."*

## What it is

| Piece | Where | What it does |
|---|---|---|
| One thread | `chat_messages` (thread `corner`) + `src/lib/channels/thread.ts` | Every turn — app, Telegram, WhatsApp, Slack, SMS — is one row with `channel` set. `GET /api/channels/thread` is the unified read. |
| One Unc | `src/lib/unc/respond.ts` `respondAsUnc` | The chat pipeline factored out of `POST /api/unc/chat` (same prompt, brain recall, memory hook). A channel message runs it over the account's persisted state + the whole cross-channel history. |
| Links | `channel_links` + `src/lib/channels/links.ts` | One-time link code (`UNC-XXXXXX`, 10 min) sent from the device verifies it. Slack links by the OAuth install. `user_id` = the founder who linked → `decided_by` for channel decisions. |
| Adapters | `src/lib/channels/adapters/{telegram,whatsapp,slack,twilio}.ts` | `send()`, `verify*Webhook()`, `parse*()` per channel. Env-gated; fetch + node crypto only. |
| Inbound | `src/lib/channels/webhooks.ts` (receive: verify FIRST → parse → 200 fast) → `src/lib/channels/inbound.ts` (`handleInbound`, runs after the response via `next/server` `after`) | Link handshake · unknown sender gets one honest line · button / keyword → **the same approve/hold path the app uses** (`decideApproval` → `resumeApproval`) → receipt line in Unc's voice; "Why" → the approval's reasoning · text → `respondAsUnc` → reply stored with its channel and sent back. Idempotent on the platform message id. |
| Outbound | `src/lib/channels/outbound.ts` + ledger `outbound_messages` | `sendOnLink` (always ledgered: sent / failed / queued), `pushToAccount` (prefs per kind, quiet hours in the account's timezone, durable dedup on `ref` per link, one thread row per push), WhatsApp 24-hour rule. |
| Worker tick | `src/worker/channels.ts` `runChannelsTick` | Pushes new daily briefs, the first draft of each run, new approvals (buttons) and approvals lapsing within 2 h. App-only accounts get nothing extra. |
| Secrets | `channel_secrets` + `src/lib/channels/secrets.ts` | Slack bot token per workspace, sealed with the connector keyring (`CONNECTOR_SECRET_KEY`), AAD `slack:<team_id>`. Service role only. |
| UI | `src/components/platform/ConnectChannelStep.tsx`, `ChannelsSettings.tsx` | First-run "Where should I reach you?" card (exact link instruction + live status, honest "later") and the settings view (prefs, quiet hours, unlink, add another). |
| Routes | `src/app/api/channels/{links,thread,slack/start,slack/callback}` · `src/app/api/webhooks/{telegram,whatsapp,slack,twilio}` | Session-bound management; public verified webhooks. |
| Migration | `supabase/migrations/0012_channels.sql` | `channel_links`, `outbound_messages`, `channel_secrets`; `chat_messages` + `channel`, `external_msg_id`, `delivery`. RLS: members read; every write is the service role. |

Safety rails hold: nothing publishes, sends to customers or spends from a channel. A decision on a channel is the same decision as the Approve / Hold button in the app (same `taste_event`, same receipt); with the shipped `RefusingExecutor` an approval still fails closed and Unc says so ("Nothing changes yet: live mode is off").

## The two mount lines (mounted 2026-09-02 — Sidebar.tsx `{ key: "channels" }` entry in accounts mode only; Platform.tsx renders `<ChannelsSettings />` for `view === "channels"`)

**First run** (Platform.tsx, in the guided spine after the first routine is on — step 3 → this → step 4/5):

```tsx
import ConnectChannelStep from "./ConnectChannelStep";
// …inside the accounts-mode Getting-set-up sequence:
<ConnectChannelStep onDone={(choice) => { /* "linked" | "later" | "app" → mark the step done, advance */ }} />
```

**Settings** (Sidebar.tsx nav entry "Channels" → Platform.tsx view switch):

```tsx
import ChannelsSettings from "./ChannelsSettings";
// Sidebar: add { key: "channels", label: "Channels" } to the nav (Tom's vocabulary: "Channels")
// Platform view switch:
case "channels": return <ChannelsSettings />;
```

Both are `"use client"`, accounts-mode only (they fetch `/api/channels/links`; demo mode gets `{ fallback: true }` and should not mount them). Both accept `initial` for a server render / tests.

## The chip (built 2026-09-02 — CornerBuddy.tsx + useChannelThread.ts)

The corner chat renders the client's own `S.messages` (channel `app`, persisted by the autosave at positions 0..n). Channel turns never enter that array (`loadAccountRows` hydrates only `channel = 'app'` rows), so the corner UI merges them from the API (`src/components/platform/useChannelThread.ts`):

- Accounts mode only, AI lane only: `GET /api/channels/thread?since=<last now>` on open, then every **20 s** while the corner is open (`THREAD_POLL_MS`); the response's `now` is the next `since`; rows are deduplicated by id; errors are silent.
- `mergeThread(local, remote)` (pure, tested) interleaves the non-app rows with the local bubbles by time, using the thread's own app rows as anchors: a channel row said after k app turns sits after the k-th local bubble (a stripped demo seed offsets the anchors; unsaved local turns stay at the end). Staff rows never sit on this thread.
- Channel rows render as the same bubbles (`sender: "user"` → founder bubble, `"unc"` → Unc bubble) with a chip under the bubble: **"via Telegram"** / "via WhatsApp" / "via Slack" / "via Text" (`viaLabel()` over `CHANNEL_LABEL`). Chip style: **10px, uppercase, `var(--cyan-text)` on `var(--cyan-wash)`**, pill — no amber. App messages are unchanged.
- Nothing polls in demo mode; `initialThread` lets a server render / test pass rows in.

## Per channel — what Tom must create, env vars, webhook URLs

`APP_URL` must be the public origin (e.g. `https://app.getjunction.ai`). Every webhook verifies its signature **before** reading the body; a failed check is `401` and nothing is processed.

### Telegram (2 minutes)
1. BotFather → `/newbot` → name **Unc** (username e.g. `UncJunctionBot`). Copy the token.
2. Pick a random webhook secret: `openssl rand -hex 24`.
3. Env: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `TELEGRAM_BOT_USERNAME=UncJunctionBot`.
4. Register the webhook once (the secret is echoed back on every delivery as `X-Telegram-Bot-Api-Secret-Token`):
   ```bash
   curl -sS "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
     -d url="https://<APP_URL>/api/webhooks/telegram" -d secret_token="$TELEGRAM_WEBHOOK_SECRET" \
     -d allowed_updates='["message","callback_query"]'
   ```
5. Founder link: the card shows `https://t.me/UncJunctionBot?start=UNC-XXXXXX` (or they send the code). Approvals arrive with an inline keyboard **Approve / Hold / Why**.

### WhatsApp — reuse Junction's existing Cloud API app + number
Junction already has a Meta app with WhatsApp (the Rory Corner "Junction Corner" developer app; see the `rory-whatsapp-setup` memory). Reuse it: same app, same number (or add a second number to the WABA for Unc).
1. Env: `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN` (a **System User** token, never the 1-hour dashboard token), `WHATSAPP_VERIFY_TOKEN` (any random string), `WHATSAPP_APP_SECRET` (App → Settings → Basic), `WHATSAPP_DISPLAY_NUMBER=+64…` (the number founders message, for the `wa.me` link). Optional: `WHATSAPP_BRIEF_TEMPLATE` (default `unc_brief`), `WHATSAPP_TEMPLATE_LANG` (default `en`).
2. App → WhatsApp → Configuration → Webhook: callback `https://<APP_URL>/api/webhooks/whatsapp`, verify token = `WHATSAPP_VERIFY_TOKEN`, subscribe to **messages**. Meta signs every POST with `X-Hub-Signature-256` (HMAC-SHA256 of the raw body under the app secret).
3. **The 24-hour rule.** Free-form messages are only allowed within 24 h of the founder's last message. Outside the window:
   - the **morning brief** goes as the approved **template `unc_brief`** — it must exist in WhatsApp Manager → Message templates, category *Utility*, language `en`, body exactly `{{1}}` (one text parameter; Unc squashes whitespace into it). Until it is approved, briefs outside the window are recorded as `failed` with Meta's error code.
   - **everything else** (approvals, drafts, reminders) is **queued** (`outbound_messages.status = queued`) and flushed the moment the founder writes anything — the welcome line says so.
4. Founder link: `https://wa.me/<number>?text=UNC-XXXXXX`. Approvals arrive as interactive reply buttons (max 3: **Approve / Hold / Why**).

### Slack — one app, installed per workspace
1. api.slack.com → Create app → **From manifest** (below) → Install to your own workspace to test. Copy Client ID, Client Secret, Signing Secret.
2. Env: `SLACK_CLIENT_ID`, `SLACK_CLIENT_SECRET`, `SLACK_SIGNING_SECRET`. The bot token is **per workspace** and never in env — it is sealed into `channel_secrets` on install (needs `CONNECTOR_SECRET_KEY`).
3. Founder link: **Add to Slack** → `GET /api/channels/slack/start` → Slack consent → `https://<APP_URL>/api/channels/slack/callback`. The installing user is the linked destination; Unc DMs them.
4. Manifest (replace `<APP_URL>`):
   ```yaml
   display_information:
     name: Unc
     description: The marketing department that runs your growth beside you.
   features:
     bot_user:
       display_name: Unc
       always_online: true
   oauth_config:
     redirect_urls:
       - https://<APP_URL>/api/channels/slack/callback
     scopes:
       bot: [chat:write, im:history, im:write, im:read, app_mentions:read, users:read]
   settings:
     event_subscriptions:
       request_url: https://<APP_URL>/api/webhooks/slack
       bot_events: [message.im, app_mention]
     interactivity:
       is_enabled: true
       request_url: https://<APP_URL>/api/webhooks/slack
     org_deploy_enabled: false
     socket_mode_enabled: false
   ```
   One URL serves both the Events API (JSON; `url_verification` is answered after the signature check) and Interactivity (`payload=` form; Block Kit **Approve / Hold / Why**). Requests older than 5 minutes are rejected (replay).

### SMS — Twilio
1. Twilio Console → buy a number with SMS (NZ/AU: check the number can receive inbound SMS; an alphanumeric sender cannot).
2. Env: `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM=+15550001111`.
3. Number → Messaging → "A message comes in": Webhook `POST https://<APP_URL>/api/webhooks/twilio`. Twilio signs with `X-Twilio-Signature` over exactly that URL + the form fields, so `APP_URL` must match what you typed. Unc answers empty TwiML and replies through the REST API.
4. Founder link: `sms:<number>?&body=UNC-XXXXXX` ("text the code to the number"). Approvals arrive as text: *Reply YES <id>, HOLD <id> or WHY <id>* — the id is the first 8 characters of the approval id; a bare YES / HOLD / WHY works when exactly one decision is waiting.

### Email
Listed in the enum, not switched on — the card says so honestly.

## Prefs, quiet hours, what goes where
Per link (`channel_links.prefs`): `brief`, `approvals` (approvals + 2-hour reminders), `drafts`, `quiet_hours {start, end}` in the account's timezone (`account_profiles.cadence.timezone`, else UTC). Inside quiet hours pushes are held (not ledgered) and the next tick outside the window sends them; replies to the founder's own messages are never held. Dedup is `outbound_messages.ref` per link (`brief:<id>`, `draft:<run_id>`, `approval:<id>`, `reminder:<id>`) — durable across restarts.

## Worker registration (B's file — two lines in `src/worker/loop.ts`)
`src/worker/channels.ts` is worker-buildable (relative imports; `npx tsc -p tsconfig.worker.json` compiles it). It is not a cron-slot job: it should run every tick after the briefs.

```ts
import { runChannelsTick } from "./channels";
// in Worker.tick(), after `report.briefs = await this.runDueBriefs(now);`
if (this.deps.db) { try { await runChannelsTick({ store: this.deps.store, db: this.deps.db, now: this.now, log: this.log, env: process.env, keyring: envKeyring(process.env) }); } catch (err) { this.log.warn("channels.tick_failed", { error: err instanceof Error ? err.message : String(err) }); } }
```

Optional CLI one-shot for `main.ts`: `--channels` → `runChannelsTick(deps)`.

## Test map
`src/lib/channels/__tests__/`: `adapters.test.ts` (signatures valid / invalid / replayed, parsing, request shapes), `linksThread.test.ts` (code lifecycle, one thread, client hydration), `outbound.test.ts` (prefs, quiet hours, dedup, WhatsApp window + queue), `inbound.test.ts` (handshake, unknown sender, reply path, decisions on MemoryStore + SupabaseStore, Why, SMS keywords), `worker.test.ts` (tick pushes once), `webhooksOauth.test.ts` (receivers, Slack install state), `routes.test.ts` (links / thread / telegram route); `src/components/platform/__tests__/channels.test.ts` (copy floor, honest states).

## Gaps (honest)
- Slack: an unknown user DMing the bot in an installed workspace gets no reply (we don't guess which account's token to use).
- WhatsApp: the `unc_brief` template must be approved by Meta before out-of-window briefs deliver; until then they read `failed` in the ledger.
- SMS is text-only — long briefs are cut at ~1500 chars.
- (closed 2026-09-02) The corner chip and the two mounts are wired: Sidebar "Channels" entry (accounts mode), Platform view switch, CornerBuddy 20-s poll + "via …" chip.
