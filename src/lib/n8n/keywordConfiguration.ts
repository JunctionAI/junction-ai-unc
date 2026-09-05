import { z } from "zod";
import { keywordCommandMarket } from "./keywordCommand";
import { commandSelectionReleased } from "../commands/releaseScope";
import type { RoutineSpec, N8nWorkflow } from "../runtime/types";

export const keywordMarket = z.enum(["US", "NZ", "AU"]);
export const keywordConfigurationSave = z.object({ market: keywordMarket,
  version: z.number().int().min(1).max(2), stateUpdatedAt: z.string().datetime({ offset: true }).nullable() }).strict();
const snapshot = z.object({ accountId: z.string().uuid(), actorId: z.string().uuid(), contextGeneration: z.number().int().nonnegative(),
  routineId: z.literal("D03-W01"), version: z.number().int().positive(), stateUpdatedAt: z.string().nullable(),
  enabled: z.boolean(), hasDraft: z.boolean(), paused: z.boolean(), spec: z.unknown(), workflow: z.unknown(),
  candidates: z.array(z.object({ market: keywordMarket, spec: z.unknown(), sourceRunId: z.string().uuid() }).strict()).max(3),
}).strict();

/** The RPC's recipes remain server-side. A browser receives business settings, not
 * an editable webhook, credential selector, arbitrary recipe or release authority. */
export function readKeywordConfiguration(raw: unknown, ctx: { accountId: string; actorId: string; contextGeneration: number }) {
  const s = snapshot.parse(raw);
  if (s.accountId !== ctx.accountId || s.actorId !== ctx.actorId || s.contextGeneration !== ctx.contextGeneration ||
    s.stateUpdatedAt !== null && !Number.isFinite(Date.parse(s.stateUpdatedAt))) throw Error("Configuration identity changed");
  const actor = { ...ctx, userId: ctx.actorId, channel: "app" as const, requestId: "configuration" };
  const workflow = s.workflow as N8nWorkflow | null;
  const seen = new Set<string>();
  for (const c of s.candidates) {
    if (!c.spec || keywordCommandMarket(actor, c.spec as RoutineSpec, workflow) !== c.market || seen.has(c.market))
      throw Error("Unreviewed configuration");
    seen.add(c.market);
  }
  const market = s.spec ? keywordCommandMarket(actor, s.spec as RoutineSpec, workflow) : null;
  return { candidates: s.candidates, view: { ...ctx, routineId: s.routineId, version: s.version, stateUpdatedAt: s.stateUpdatedAt,
    enabled: s.enabled, hasDraft: s.hasDraft, paused: s.paused, market,
    markets: s.candidates.map(c => c.market), seedKeyword: "golf travel bag", primaryDomain: "avgarsport.com", languageCode: "en",
    released: !!market && commandSelectionReleased(actor, s.spec as RoutineSpec, workflow),
  } };
}
