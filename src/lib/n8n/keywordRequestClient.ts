import { z } from "zod";
import type { AgentContext } from "../agents/client";
import { artifactHeaders } from "../artifacts/client";
export const keywordRequestSelection = z.object({ market: z.enum(["US","NZ","AU"]), version: z.literal(2), stateUpdatedAt: z.string().datetime({offset:true}) }).strict();
export type KeywordRequestSelection = z.infer<typeof keywordRequestSelection>;
export const keywordRequestBody = keywordRequestSelection.extend({ requestId: z.string().uuid() }).strict();
const journalSchema = keywordRequestBody.extend({accountId:z.string().uuid(),actorId:z.string().uuid(),contextGeneration:z.number().int().nonnegative()}).strict();
export type KeywordRequestJournal = z.infer<typeof journalSchema>;
const outcomeSchema = z.object({accountId:z.string().uuid(),actorId:z.string().uuid(),contextGeneration:z.number().int().nonnegative(),requestId:z.string().uuid(),
  routineId:z.literal("D03-W01"),phase:z.enum(["record","not_found","refused"]),reply:z.string().max(4000),canStartNew:z.boolean(),
  command:z.object({id:z.string().uuid(),status:z.enum(["queued","running","waiting","done","blocked","failed","uncertain"]),runId:z.string().uuid().nullable()}).strict().nullable(),
}).strict();
export type KeywordRequestOutcome = z.infer<typeof outcomeSchema>;
export const KEYWORD_REQUEST_EVENT="unc-keyword-request";
export const keywordRequestKey=(ctx:AgentContext)=>`unc:keyword-request:v1:${ctx.actorId}:${ctx.accountId}:${ctx.contextGeneration}`;
export function loadKeywordRequest(ctx:AgentContext,storage:Pick<Storage,"getItem">=sessionStorage):KeywordRequestJournal|null {
  const raw=storage.getItem(keywordRequestKey(ctx));if(raw===null)return null;
  if(raw.length>2048)throw Error("Saved request cannot be verified. Check account history before starting another.");
  const j=journalSchema.parse(JSON.parse(raw));
  if(j.accountId!==ctx.accountId||j.actorId!==ctx.actorId||j.contextGeneration!==ctx.contextGeneration)throw Error("Saved request belongs to another context.");
  return j;
}
export function startKeywordRequest(ctx:AgentContext,selection:KeywordRequestSelection,storage:Storage=sessionStorage):KeywordRequestJournal {
  if(loadKeywordRequest(ctx,storage))throw Error("Check the original request before starting another.");
  const j=journalSchema.parse({...selection,...ctx,requestId:crypto.randomUUID()});
  storage.setItem(keywordRequestKey(ctx),JSON.stringify(j));
  if(typeof window!=="undefined")window.dispatchEvent(new Event(KEYWORD_REQUEST_EVENT));
  return j;
}
export function clearKeywordRequest(ctx:AgentContext,j:KeywordRequestJournal,outcome:KeywordRequestOutcome,storage:Storage=sessionStorage) {
  if(!outcome.canStartNew||outcome.requestId!==j.requestId||outcome.accountId!==ctx.accountId||outcome.actorId!==ctx.actorId||outcome.contextGeneration!==ctx.contextGeneration||
    loadKeywordRequest(ctx,storage)?.requestId!==j.requestId)throw Error("Original outcome must be resolved first.");
  storage.removeItem(keywordRequestKey(ctx));if(typeof window!=="undefined")window.dispatchEvent(new Event(KEYWORD_REQUEST_EVENT));
}
export async function sendKeywordRequest(j:KeywordRequestJournal,inspect:boolean,fetcher:typeof fetch=fetch,signal?:AbortSignal):Promise<KeywordRequestOutcome> {
  journalSchema.parse(j);
  const path="/api/routines/keyword-request";
  const res=await fetcher(inspect?`${path}?requestId=${encodeURIComponent(j.requestId)}`:path,{method:inspect?"GET":"POST",cache:"no-store",signal,
    headers:{"content-type":"application/json",...artifactHeaders(j.accountId,j.contextGeneration),"x-unc-actor-id":j.actorId},
    ...(inspect?{}:{body:JSON.stringify({requestId:j.requestId,market:j.market,version:j.version,stateUpdatedAt:j.stateUpdatedAt})})});
  const parsed=outcomeSchema.safeParse(await res.json());
  if(!res.ok||!parsed.success)throw Error("Outcome not confirmed. Check the original request; no automatic retry was sent.");
  const o=parsed.data;
  if(o.accountId!==j.accountId||o.actorId!==j.actorId||o.contextGeneration!==j.contextGeneration||o.requestId!==j.requestId||
    (o.phase==="record"?!o.command:o.command!==null)||o.command?.runId&&o.command.runId!==o.command.id||o.phase==="not_found"&&o.canStartNew||
    o.phase==="record"&&o.canStartNew&&!['done','failed','blocked'].includes(o.command!.status))throw Error("Request response identity or state changed.");
  return o;
}
