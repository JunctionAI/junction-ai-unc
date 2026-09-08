import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {z} from 'zod';
import type {DbClient} from '../db/types';
import {reviewOutputSchema} from './reviewContract';
import {reviewContentSchema,registerReviewOutput} from './reviewProducer';
import {reviewMediaKey} from './reviewMedia';

const PLATFORM='review_output_intake_grant';
export const reviewIntakeGrantSchema=z.object({
 id:z.uuid(),workerId:z.string().min(1).max(120),contextGeneration:z.number().int().nonnegative(),
 sourceRunId:z.uuid(),output:reviewOutputSchema,
 issuedAt:z.iso.datetime({offset:true}),expiresAt:z.iso.datetime({offset:true}),
}).strict().refine(g=>g.output.ref.revision===0,'Only initial output intake');
export type ReviewIntakeGrant=z.infer<typeof reviewIntakeGrantSchema>;
function validTime(g:ReviewIntakeGrant,now:number){
 const start=Date.parse(g.issuedAt),end=Date.parse(g.expiresAt);
 return Number.isFinite(now)&&start<=now&&now<end&&end>start&&end-start<=3600000;
}
export function reviewIntakeToken(input:ReviewIntakeGrant,secret:string){
 if(secret.length<32)throw new Error('Intake signing unavailable');
 return createHmac('sha256',secret).update(`junction.review-output.v1:${JSON.stringify(reviewIntakeGrantSchema.parse(input))}`).digest('base64url');
}
export async function readReviewIntakeGrant(db:DbClient,id:string){
 const r=await db.from('receipts').select('account_id,payload').eq('id',id).eq('platform',PLATFORM).maybeSingle();
 if(r.error)throw new Error('Intake grant unavailable');
 const row=r.data as {account_id:string;payload:{grant:unknown}}|null;
 const parsed=reviewIntakeGrantSchema.safeParse(row?.payload?.grant);
 return parsed.success&&parsed.data.id===id&&parsed.data.output.ref.accountId===row?.account_id?parsed.data:null;
}
/** Trusted dispatcher only: it must resolve the client/runtime binding itself.
 * Persist before dispatch; this does not call Grok or enable a routine. */
export async function issueReviewIntakeGrant(db:DbClient,input:ReviewIntakeGrant,secret:string,now=Date.now()){
 const grant=reviewIntakeGrantSchema.parse(input);
 if(!validTime(grant,now))throw new Error('Invalid intake expiry');
 const token=reviewIntakeToken(grant,secret);
 const r=await db.from('receipts').insert({id:grant.id,account_id:grant.output.ref.accountId,kind:'notification',platform:PLATFORM,
  description:'Finished output requested; no execution authority.',payload:{grant}});
 if(r.error?.code==='23505'){
  const prior=await readReviewIntakeGrant(db,grant.id);
  if(JSON.stringify(prior)!==JSON.stringify(grant))throw new Error('Conflicting intake grant');
 }else if(r.error)throw new Error('Intake grant unavailable');
 return {grantId:grant.id,authorization:`Bearer ${token}`,path:`/api/external-agents/outputs/${grant.id}`};
}
type Dependencies={
 enabled:boolean;secret:string;resolve:(id:string)=>Promise<ReviewIntakeGrant|null>;
 released:(accountId:string)=>boolean;checkContext:(g:ReviewIntakeGrant)=>Promise<void>;
 storage:{isPrivate:()=>Promise<boolean>;read:(path:string,maxBytes:number)=>Promise<Uint8Array|null>};
 register:(g:ReviewIntakeGrant,content:z.infer<typeof reviewContentSchema>)=>ReturnType<typeof registerReviewOutput>;
 now?:()=>number;
};
const reply=(status:number,body:unknown)=>Response.json(body,{status,headers:{'cache-control':'no-store',vary:'Authorization'}});
async function body(request:Request){
 if(!request.headers.get('content-type')?.startsWith('application/json'))throw new Error('JSON required');
 const reader=request.body?.getReader();if(!reader)throw new Error('Body required');
 const chunks:Uint8Array[]=[];let size=0;
 try{while(true){const r=await reader.read();if(r.done)break;size+=r.value.length;
  if(size>128000){await reader.cancel();throw new Error('Body too large');}chunks.push(r.value);}
  return z.object({content:reviewContentSchema}).strict().parse(JSON.parse(Buffer.concat(chunks).toString('utf8'))).content;
 }finally{reader.releaseLock();}
}
/** Accepts finished drafts only. It cannot publish, approve, send, schedule or
 * create a source run. Media must already exist at its exact private immutable key. */
export async function receiveReviewOutput(request:Request,grantId:string,deps:Dependencies){
 if(!deps.enabled)return reply(503,{error:'Output intake not released'});
 const auth=request.headers.get('authorization')??'';
 if(!z.uuid().safeParse(grantId).success||!/^Bearer [A-Za-z0-9_-]{43}$/.test(auth))return reply(401,{error:'Unauthorized'});
 try{
  const raw=await deps.resolve(grantId),parsed=reviewIntakeGrantSchema.safeParse(raw);
  if(!parsed.success||parsed.data.id!==grantId)return reply(401,{error:'Unauthorized'});
  const grant=parsed.data,expected=`Bearer ${reviewIntakeToken(grant,deps.secret)}`;
  if(!timingSafeEqual(Buffer.from(auth),Buffer.from(expected)))return reply(401,{error:'Unauthorized'});
  if(!deps.released(grant.output.ref.accountId))return reply(503,{error:'Output intake not released'});
  const now=()=>deps.now?.()??Date.now();
  if(!validTime(grant,now()))return reply(410,{error:'Output intake expired'});
  let content:z.infer<typeof reviewContentSchema>;
  try{content=await body(request);}catch{return reply(400,{error:'Invalid finished output'});}
  const kind=grant.output.kind;
  if((kind==='image'||kind==='email')&&!content.media?.image||kind==='video'&&(!content.media?.video||grant.output.durationSeconds===null)||
    ['sms','article','outreach','brief','decision'].includes(kind)&&!content.body)return reply(400,{error:'Required finished content missing'});
  await deps.checkContext(grant);
  if(content.media?.image||content.media?.video){
   if(!await deps.storage.isPrivate())return reply(503,{error:'Private media unavailable'});
   for(const slot of ['image','video'] as const){const media=content.media?.[slot];if(!media)continue;
    const path=reviewMediaKey(grant.output.ref.accountId,grant.contextGeneration,grant.output.ref.outputId,0,slot,media.format);
    const bytes=await deps.storage.read(path,media.bytes);
    if(!bytes||bytes.length!==media.bytes||createHash('sha256').update(bytes).digest('hex')!==media.sha256)return reply(409,{error:'Media verification failed'});
   }
  }
  await deps.checkContext(grant);
  if(!validTime(grant,now()))return reply(410,{error:'Output intake expired'});
  const receipt=await deps.register(grant,content);
  return reply(receipt.duplicate?200:201,{saved:true,...receipt,executed:false});
 }catch{return reply(503,{error:'Output intake unavailable; reconcile before retrying generation'});}
}
