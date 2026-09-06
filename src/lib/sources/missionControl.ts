import { z } from "zod";

const EXPECTED_URL = "https://ebcatvidixdjjwmmades.supabase.co/functions/v1/unc-source-read";
const uuid = z.string().uuid().transform(value => value.toLowerCase());
const nullableNumber = z.number().finite().nullable();
const campaign = z.object({
  id: z.string().min(1).max(200), campaignId: z.string().max(200).nullable(), messageId: z.string().max(200).nullable(),
  name: z.string().max(1000).nullable(), subject: z.string().max(2000).nullable(), previewText: z.string().max(4000).nullable(),
  sentAt: z.string().refine(value => Number.isFinite(Date.parse(value))), segment: z.string().max(1000).nullable(),
  recipients: z.number().int().nonnegative().nullable(), openRate: nullableNumber, clickRate: nullableNumber,
  placedOrderRate: nullableNumber, unsubscribeRate: nullableNumber, spamRate: nullableNumber,
  bounceRate: nullableNumber, revenue: nullableNumber,
  metricsUpdatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))).nullable(),
  updatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))).nullable(),
}).strict();
export const missionControlEmailSchema = z.object({
  contract: z.literal("junction.source.email-campaigns.v1"), accountId: uuid,
  sourceProject: z.literal("ebcatvidixdjjwmmades"), sourceKind: z.enum(["public.client_accounts", "junction.client_orgs"]),
  sourceKey: z.string().min(1).max(200).regex(/^\S+$/), dataset: z.literal("email_campaigns"),
  sourceRowCount: z.number().int().nonnegative(),
  sourceMaxUpdatedAt: z.string().refine(value => Number.isFinite(Date.parse(value))).nullable(),
  rows: z.array(campaign).max(500), bridgeFetchedAt: z.string().refine(value => Number.isFinite(Date.parse(value))),
  bridgeDeploymentId: z.string().max(500).nullable(),
}).strict();
export type MissionControlEmailRead = z.infer<typeof missionControlEmailSchema>;

export interface MissionControlSourceInput { accountId: string; sourceProject: string; sourceKind: string; sourceKey: string; limit: number }
export async function readMissionControlEmailCampaigns(input: MissionControlSourceInput, deps: { env?: Record<string,string|undefined>; fetch?: typeof fetch } = {}): Promise<MissionControlEmailRead> {
  const env = deps.env ?? process.env;
  const url = (env.MISSION_CONTROL_SOURCE_URL ?? "").trim(), token = env.MISSION_CONTROL_SOURCE_TOKEN ?? "";
  if (url !== EXPECTED_URL || token.length < 32 || token.length > 512 || /\s/.test(token)) throw new Error("mission control source bridge is not configured");
  if (!uuid.safeParse(input.accountId).success || input.sourceProject !== "ebcatvidixdjjwmmades" || !["public.client_accounts","junction.client_orgs"].includes(input.sourceKind) || !/^\S{1,200}$/.test(input.sourceKey) || !Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 500)
    throw new Error("invalid mission control source identity");
  const response = await (deps.fetch ?? fetch)(url, { method:"POST", headers:{ authorization:`Bearer ${token}`, "content-type":"application/json" },
    body:JSON.stringify(input), signal:AbortSignal.timeout(20_000), cache:"no-store" });
  if (!response.ok) throw new Error(response.status === 403 ? "mission control source read is not granted" : "mission control source read failed");
  const length = Number(response.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > 2_000_000) throw new Error("mission control source response too large");
  const raw = await response.text();
  if (raw.length > 2_000_000) throw new Error("mission control source response too large");
  const parsed = missionControlEmailSchema.safeParse(JSON.parse(raw));
  if (!parsed.success || parsed.data.accountId !== input.accountId.toLowerCase() || parsed.data.sourceProject !== input.sourceProject || parsed.data.sourceKind !== input.sourceKind || parsed.data.sourceKey !== input.sourceKey || parsed.data.rows.length > input.limit)
    throw new Error("mission control source response identity mismatch");
  return parsed.data;
}
