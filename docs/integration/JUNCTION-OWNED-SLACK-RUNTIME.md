# Junction-owned client agents: migration decision

6 September 2026. Status: implementation in progress, not connected-client acceptance.

## Owner direction

Keep the clients' existing communication channels, but replace the execution
dependency on Hyperagent with Junction's own governed runtime. Hyperagent is an
inventory/history source, not the authority for client access or routine choice.
Do not copy its autonomy settings or treat attached writer tools as permission.

## Target request path

1. A signed Slack event identifies the workspace, channel, sender and thread.
2. A registered workspace/channel route selects exactly one client. Independently
   verified sender membership decides whether that person may request the work.
   A shared Slack user must not move a connection between clients on reinstall.
3. Junction interprets the request against that client's enabled routine IDs.
   The model may propose a routine; the dispatcher validates scope, inputs,
   account generation, enabled status and action authority before execution.
4. The routine uses account-scoped stored data with visible source freshness.
   Refreshes and writes use the registered provider connection, not credentials
   pasted into prompts. Native-only grants need a supported new connection;
   their transferability must not be assumed.
5. The existing durable command queue runs the approved implementation, including
   registered n8n workflows where applicable. Store the result and execution
   evidence before making it eligible for delivery.
6. The outbox rechecks the original client/route/sender binding and returns the
   result to the originating Slack thread. No fallback to another room or DM.
   Retries must not repeat uncertain provider actions or duplicate messages.

The agent is therefore a conversational entry point to tested routines, not a
second unconstrained automation system. Enabling 1/7 or 3/7 routines changes the
allowlist; it does not require seven combinations of duplicate workflows.

## Current code batch

The Slack event and message-button parsers now preserve `conversationId` and the
exact string `threadId`, independently of sender `externalId` and workspace
`scopeId`. Top-level messages use their own timestamp as the prospective thread
root. Message buttons retain the message's root thread. Missing message origins,
contradictory message timestamps and malformed thread timestamps are refused;
an App Home/modal interaction does not silently become a DM approval.

The durable ingress snapshot retains those fields, strips unknown authority
fields, and detects changed/lost thread metadata in its persisted readback.
This is **origin capture only**. It does not yet change account lookup, authorize
shared rooms, propagate origin through commands/outbox, or change Slack delivery.
Do not deploy this as a claim that shared-channel routing is finished.

Local verification: 3,083 tests across 228 files pass, application TypeScript
passes, and focused ESLint passes. No provider calls, route migration or customer
messages were used to obtain these results. Production is unchanged.

## Remaining implementation and cutover gates

- Codex: route registry and independent sender authorization; replacement of the
  sender-only account lookup; owner-verified provisioning without inferred roles.
- Codex: preserve origin through commands, asynchronous completion, approval
  handling and immutable outbox; isolate conversational context by audience.
- Codex: verify provider grants and per-client routine mappings; expose stale,
  expired and missing connections as actionable failures, not successful work.
- Codex: test two clients sharing a Slack sender, wrong-room refusal, removed
  membership, route revision changes, replay, uncertain delivery and recovery.
  Proactive messages need one explicit audience binding, not one post per member.
- Nguyen: complete the agreed workflow contracts and provider-backed execution
  evidence. Do not redesign frozen wrappers merely for the Slack migration.
- Owner/workspace admin where required: approve the exact app installation,
  client route and bounded pilot/cutover. No new customer messages in this batch.

Keep existing Hyperagent listeners unchanged until the Junction path has passed
an authorized pilot. Cut over one client/channel at a time, with one active
responder and a rollback path. Keeping the same channel does not mean Junction
can inherit Hyperagent's bot identity or OAuth tokens.

Official references consulted: [Slack app mentions](https://docs.slack.dev/reference/events/app_mention/)
and [message interaction payloads](https://docs.slack.dev/reference/interaction-payloads/block_actions-payload/).
