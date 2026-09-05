import { z } from "zod";
import { artifactHeaders } from "../artifacts/client";
import type { AgentContext } from "../agents/client";
const market = z.enum(["US", "NZ", "AU"]);
const view = z.object({ accountId: z.string().uuid(), actorId: z.string().uuid(), contextGeneration: z.number().int().nonnegative(),
  routineId: z.literal("D03-W01"), version: z.number().int().positive(), stateUpdatedAt: z.string().nullable(),
  enabled: z.boolean(), hasDraft: z.boolean(), paused: z.boolean(), market: market.nullable(), markets: z.array(market).max(3),
  seedKeyword: z.literal("golf travel bag"), primaryDomain: z.literal("avgarsport.com"), languageCode: z.literal("en"), released: z.boolean(),
}).strict();
export type KeywordConfigurationView = z.infer<typeof view>;
export type KeywordMarket = z.infer<typeof market>;
export async function keywordConfigurationRequest(ctx: AgentContext, save?: { market: KeywordMarket; version: number; stateUpdatedAt: string | null },
  fetcher: typeof fetch = fetch, signal?: AbortSignal): Promise<KeywordConfigurationView> {
  if (!ctx.actorId) throw Error("Account identity is not verified.");
  const res = await fetcher("/api/routines/keyword-configuration", { method: save ? "POST" : "GET", cache: "no-store", signal,
    headers: { ...artifactHeaders(ctx.accountId, ctx.contextGeneration), ...(save ? { "content-type": "application/json" } : {}) },
    ...(save ? { body: JSON.stringify(save) } : {}) });
  const body = view.safeParse(await res.json());
  if (!res.ok || !body.success || body.data.accountId !== ctx.accountId || body.data.actorId !== ctx.actorId ||
    body.data.contextGeneration !== ctx.contextGeneration || body.data.stateUpdatedAt !== null && !Number.isFinite(Date.parse(body.data.stateUpdatedAt)) ||
    new Set(body.data.markets).size !== body.data.markets.length ||
    save && (body.data.market !== save.market || body.data.enabled || body.data.hasDraft || body.data.version !== 2))
    throw Error(save ? "Save not confirmed. Refresh to check the saved market; don’t repeat the save automatically." : "Couldn’t verify keyword settings for this account. Refresh to try again.");
  return body.data;
}
