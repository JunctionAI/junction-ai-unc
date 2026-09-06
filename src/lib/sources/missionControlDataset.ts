import { z } from "zod";
import { unwrap, type DbClient } from "../db/types";
import { KLAVIYO_CAMPAIGN_CONTRACT, campaignHistoryQueryProblem } from "../data/klaviyoCampaigns";
import type { ConnectorReader, Platform, ReadQuery, ReadResult, RunContext } from "../runtime/types";
import { readMissionControlEmailCampaigns } from "./missionControl";

const uuid = z.string().uuid().transform(value => value.toLowerCase());
const runtimeGrant = z.object({
  grantId: uuid, accountId: uuid, contextGeneration: z.number().int().nonnegative(), bindingId: uuid,
  sourceSystem: z.literal("mission_control"), sourceProject: z.literal("ebcatvidixdjjwmmades"),
  sourceKind: z.enum(["public.client_accounts", "junction.client_orgs"]), sourceKey: z.string().min(1).max(200).regex(/^\S+$/),
  platform: z.literal("klaviyo"), dataset: z.literal("email_campaigns"),
  sourceContract: z.literal("junction.source.email-campaigns.v1"),
  maxSourceAgeMinutes: z.number().int().min(1).max(10080), bindingRevision: z.number().int().nonnegative(),
}).strict();

const listed = (accountId: string, value: string | undefined) => (value ?? "").split(",").map(x => x.trim()).filter(Boolean).includes(accountId);
export function missionControlSourceEnabled(accountId: string, platform: Platform, query: ReadQuery, env: Record<string,string|undefined>): boolean {
  return platform === "klaviyo" && !campaignHistoryQueryProblem(query) && listed(accountId, env.UNC_MISSION_CONTROL_SOURCE_ACCOUNTS);
}

function asEpoch(value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) throw new Error("stored source has an invalid timestamp");
  return parsed;
}

/** Reads normalized rows from the existing client warehouse. This never resolves
 * a provider credential and never falls back to a provider if its grant/read fails. */
export class MissionControlDatasetReader implements ConnectorReader {
  constructor(private readonly db: DbClient, private readonly deps: { env: Record<string,string|undefined>; fetch?: typeof fetch; now?: () => Date }) {}
  async read(platform: Platform, query: ReadQuery, ctx: RunContext): Promise<ReadResult> {
    if (!missionControlSourceEnabled(ctx.account.accountId, platform, query, this.deps.env))
      throw new Error("stored source is not admitted for this account and query");
    const generation = ctx.account.contextGeneration ?? 0;
    const authorized = await unwrap<unknown>("authorize stored source read", this.db.rpc("authorize_account_source_dataset_read", {
      p_account_id: ctx.account.accountId, p_context_generation: generation, p_platform: platform, p_dataset: "email_campaigns",
    }));
    const grant = runtimeGrant.safeParse(authorized);
    if (!grant.success || grant.data.accountId !== ctx.account.accountId.toLowerCase() || grant.data.contextGeneration !== generation)
      throw new Error("stored source authority identity mismatch");
    const source = await readMissionControlEmailCampaigns({ accountId: grant.data.accountId, sourceProject: grant.data.sourceProject,
      sourceKind: grant.data.sourceKind, sourceKey: grant.data.sourceKey, limit: 500 }, { env: this.deps.env, fetch: this.deps.fetch });
    if (source.sourceRowCount > source.rows.length) throw new Error("stored source history exceeds the complete-read bound");
    const now = (this.deps.now ?? (() => new Date()))();
    if (!source.sourceMaxUpdatedAt) throw new Error("stored source has no freshness timestamp");
    const sourceTime = asEpoch(source.sourceMaxUpdatedAt), age = now.getTime() - sourceTime;
    if (age < -30_000 || age > grant.data.maxSourceAgeMinutes * 60_000) throw new Error("stored source is stale or has an invalid source timestamp");
    const windowMatch = query.window ? /^(\d+)([hd])$/.exec(query.window) : null;
    const windowMs = windowMatch ? Number(windowMatch[1]) * (windowMatch[2] === "d" ? 86_400_000 : 3_600_000) : null;
    const seen = new Set<string>();
    const rows = source.rows.map(row => {
      if (seen.has(row.id)) throw new Error("stored source contains duplicate campaign IDs");
      seen.add(row.id);
      const sent = asEpoch(row.sentAt);
      if (sent > now.getTime() + 30_000) throw new Error("stored source contains a future campaign send");
      return { id: row.id, name: row.name, status: "Sent", send_time: row.sentAt, archived: null,
        subject: row.subject, preview_text: row.previewText, revenue: row.revenue, recipients: row.recipients,
        open_rate: row.openRate, click_rate: row.clickRate, placed_order_rate: row.placedOrderRate,
        unsubscribe_rate: row.unsubscribeRate, spam_rate: row.spamRate, bounce_rate: row.bounceRate,
        sends: null, opens: null, clicks: null, unsubscribes: null };
    }).filter(row => windowMs === null || asEpoch(row.send_time) >= now.getTime() - windowMs)
      .sort((a,b) => asEpoch(b.send_time)-asEpoch(a.send_time) || a.id.localeCompare(b.id));
    const selected = rows.slice(0, query.limit ?? rows.length);
    const revenues = selected.map(row => row.revenue);
    const revenue = revenues.length && revenues.every(value => typeof value === "number") ? revenues.reduce<number>((sum,value) => sum + Number(value),0) : null;
    return { rows:selected, metrics:{ campaign_history_contract:KLAVIYO_CAMPAIGN_CONTRACT,
      source_contract:source.contract,count:selected.length,matching_count:rows.length,limited:selected.length<rows.length,revenue,
      sends:null,opens:null,clicks:null,unsubscribes:null }, fetchedAt:source.sourceMaxUpdatedAt,
      provenance:selected.length ? "ok" : "empty",
      sourceNote:`Mission Control stored source ${grant.data.sourceKind}/${grant.data.sourceKey}; bridge checked ${source.bridgeFetchedAt}; no provider API call`,
    };
  }
}
