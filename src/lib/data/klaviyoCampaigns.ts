import type { ReadQuery } from "../runtime/types";

/** Sent email campaign metadata, not message copy, delivery or performance. */
export const KLAVIYO_CAMPAIGN_CONTRACT = "unc.klaviyo-campaign-history.v1";
export function campaignHistoryQueryProblem(query: ReadQuery): string | null {
  if (query.resource !== "campaigns") return "campaign history requires campaigns";
  if (query.filter && Object.keys(query.filter).length) return "campaign history does not support this filter (including tags)";
  if (query.groupBy?.length) return "campaign history does not support aggregation";
  if (query.window !== undefined) {
    const match = /^(\d+)([hd])$/.exec(query.window);
    const hours = match ? Number(match[1]) * (match[2] === "d" ? 24 : 1) : NaN;
    if (!Number.isSafeInteger(hours) || hours <= 0 || hours > 365 * 24) return "campaign history window must be 1h to 365d";
  }
  if (query.limit !== undefined && (!Number.isSafeInteger(query.limit) || query.limit < 1 || query.limit > 1000)) return "campaign history limit must be 1 to 1000";
  const fields = new Set(["id", "name", "status", "send_time", "archived", "subject", "revenue", "sends", "opens", "clicks", "unsubscribes"]);
  if (query.fields?.some(field => !fields.has(field))) return "campaign history has unsupported fields";
  return null;
}
