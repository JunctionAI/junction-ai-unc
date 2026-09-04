/** TNZ v3.00, NZ founder pilot. Transport only; never chooses a business or routine.
 * Contract: https://www.tnz.co.nz/docs/restapi/contents/3.00/3.00.yaml
 * Webhooks use a shared Authorization header, NOT a body signature. */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { smsButtonsLine } from "./twilio";
import type { ChannelAdapter, Env, FetchLike, InboundEvent, OutboundPayload, SendOptions, SendResult } from "../types";

export const TNZ_API = "https://api.tnz.co.nz/api/v3.00/sms";
export const TNZ_MAX_BODY_BYTES = 16_000;
export interface TnzConfig {
  authToken: string;
  webhookAuthorization: string;
  sender: string;
  number: string;
  pilotAccountId: string;
  pilotPhone: string;
}

export function tnzConfig(env: Env): TnzConfig | null {
  const authToken = env.TNZ_AUTH_TOKEN?.trim() ?? "";
  const webhookAuthorization = env.TNZ_WEBHOOK_AUTHORIZATION?.trim() ?? "";
  const sender = env.TNZ_SENDER?.trim() ?? "";
  const number = env.TNZ_FROM?.trim() ?? "";
  const pilotAccountId = env.TNZ_PILOT_ACCOUNT_ID?.trim() ?? "";
  const pilotPhone = env.TNZ_PILOT_PHONE?.trim() ?? "";
  // Activation explicitly attests that TNZ assigned the dedicated number to this API user.
  // FromNumber can be overridden by TNZ in NZ: configuration alone is not a delivery receipt.
  if (env.SMS_PROVIDER !== "tnz" || env.TNZ_SMS_ENABLED !== "true" || !authToken || webhookAuthorization.length < 24 || !/^(Basic|Bearer) \S+$/.test(webhookAuthorization) || !sender.includes("@") || !/^\d{4,6}$/.test(number) || !/^[a-f0-9-]{36}$/i.test(pilotAccountId) || !/^\+642\d{6,10}$/.test(pilotPhone)) return null;
  return { authToken, webhookAuthorization, sender, number, pilotAccountId, pilotPhone };
}

export function verifyTnzWebhook(config: TnzConfig, headers: Headers, now: Date): boolean {
  const actual = Buffer.from(headers.get("authorization") ?? "");
  const expected = Buffer.from(config.webhookAuthorization);
  const stamp = headers.get("x-timestamp") ?? "";
  const at = /^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(stamp) ? Date.parse(stamp) : NaN;
  return actual.length === expected.length && timingSafeEqual(actual, expected) && headers.get("x-sender") === config.sender && Number.isFinite(at) && Math.abs(now.getTime() - at) <= 5 * 60_000;
}

/** Only documented inbound types. No tenant, webhook URL or credentials from the body. */
export function parseTnzInbound(raw: unknown, config: TnzConfig): InboundEvent | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const p = raw as Record<string, unknown>;
  if (!["SMSReply", "SMSInbound"].includes(String(p.Type)) || p.Status !== "RECEIVED" || p.Result !== "RECEIVED" || p.Sender !== config.sender || p.Destination !== config.pilotPhone || typeof p.ReceivedID !== "string" || !/^[a-zA-Z0-9-]{1,100}$/.test(p.ReceivedID) || typeof p.Message !== "string" || !p.Message.trim() || p.Message.length > 4000) return null;
  return { channel: "sms", externalId: config.pilotPhone, externalMsgId: `tnz:${p.ReceivedID}`, text: p.Message.trim(), scopeId: `tnz:${config.sender}`, accountScope: config.pilotAccountId };
}

export class TnzAdapter implements ChannelAdapter {
  readonly channel = "sms" as const;
  readonly configured: boolean;
  constructor(private readonly config: TnzConfig | null, private readonly fetchFn: FetchLike) { this.configured = !!config; }

  async send(to: string, payload: OutboundPayload, opts: SendOptions): Promise<SendResult> {
    const c = this.config;
    if (!c) return { ok: false, error: "TNZ not configured" };
    if (to !== c.pilotPhone || opts.link.accountId !== c.pilotAccountId || !opts.link.verifiedAt) return { ok: false, error: "outside the verified SMS pilot" };
    const approval = payload.buttons?.find(b => b.id.startsWith("ap:"));
    const text = payload.text + (approval ? `\n${smsButtonsLine(approval.id.split(":")[1] ?? "")}` : "");
    // Do not silently lose an approval instruction, case-sensitive link or half an emoji.
    // TNZ also expands [[...]] personalisation; refuse it rather than mutate user content.
    if (!text.trim() || text.length > 1000 || /\[\[/.test(text)) return { ok: false, error: "SMS content exceeds the safe transport contract; view the full reply in the app" };
    const id = randomUUID();
    try {
      const response = await this.fetchFn(TNZ_API, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000), headers: { authorization: `Bearer ${c.authToken}`, "content-type": "application/json", accept: "application/json" }, body: JSON.stringify({ Message: text, Destination: to, MessageID: id, Reference: "Unc founder pilot", FromNumber: c.number, SubAccount: c.pilotAccountId, CharacterConversion: false, FallbackMode: "None", NotificationType: "None" }) });
      const json = await response.json().catch(() => null) as { MessageID?: unknown; Result?: unknown } | null;
      if (!response.ok || !json || (json.Result !== undefined && json.Result !== "Success") || json.MessageID !== id) return { ok: false, error: `TNZ submission unconfirmed (${response.status}); check provider history before retrying` };
      // Accepted by provider, NOT proven delivered to the handset.
      return { ok: true, externalMsgId: `tnz:${id}` };
    } catch { return { ok: false, error: "TNZ submission uncertain; check provider history before retrying" }; }
  }
}
