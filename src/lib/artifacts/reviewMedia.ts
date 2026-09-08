import { createHash } from "node:crypto";
import { z } from "zod";
import type { ReviewIdentity } from "./reviewApi";

// No caller-provided bucket, URL or storage path. Uploaders must use immutable keys.
export const REVIEW_BUCKET = "junction-review-private";
export const reviewMediaDescriptor = z.object({
  format: z.enum(["png", "jpeg", "webp", "mp4"]),
  bytes: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
}).strict();
const mime = {png:"image/png",jpeg:"image/jpeg",webp:"image/webp",mp4:"video/mp4"};
type Dependencies = {
  enabled:boolean;
  bind:(request:Request)=>Promise<ReviewIdentity|Response>;
  download:(path:string,maxBytes:number)=>Promise<Blob|null>;
};
const headers = {"cache-control":"private, no-store", "x-content-type-options":"nosniff", "cross-origin-resource-policy":"same-origin"};
const fail=(status:number)=>Response.json({error:"Review media unavailable"},{status,headers});

export async function boundedReviewBlob(stream:ReadableStream<Uint8Array>,maxBytes:number):Promise<Blob|null>{
  const reader=stream.getReader();const chunks:Uint8Array<ArrayBuffer>[]=[];let size=0;
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.byteLength;
    if(size>maxBytes){await reader.cancel();return null;}chunks.push(new Uint8Array(value));}
    return new Blob(chunks);
  }finally{reader.releaseLock();}
}

export function reviewMediaKey(accountId:string,generation:number,outputId:string,revision:number,slot:string,format:string) {
  return `${accountId}/${generation}/${outputId}/${revision}/${slot}.${format}`;
}

/** Browser media cannot attach account headers. Query values only select context;
 * bind still verifies membership and generation, and the RPC checks output ownership. */
export async function reviewMedia(request:Request,mediaId:string,deps:Dependencies):Promise<Response> {
  if(!deps.enabled)return fail(503);
  const match=/^([a-f0-9-]{36})_(image|video)$/.exec(mediaId);
  if(!match||!z.uuid().safeParse(match[1]).success)return fail(400);
  const [outputId,slot]=[match[1],match[2]];
  const params=new URL(request.url).searchParams;
  if(["account","generation","revision"].some(key=>params.getAll(key).length!==1))return fail(400);
  const account=params.get("account")!;
  const generation=Number(params.get("generation")),revision=Number(params.get("revision"));
  if(!z.uuid().safeParse(account).success||![generation,revision].every(n=>Number.isSafeInteger(n)&&n>=0))return fail(400);
  try {
    const scoped=new Headers(request.headers);
    scoped.set("x-unc-account-id",account);scoped.set("x-unc-context-generation",String(generation));
    const identity=await deps.bind(new Request(request,{headers:scoped}));
    if(identity instanceof Response)return fail(identity.status===200?503:identity.status);
    if(identity.accountId!==account||identity.contextGeneration!==generation)return fail(403);
    const {data,error}=await identity.db.rpc("read_review_output",{acct:account,generation,actor:identity.userId,output:outputId});
    if(error)return fail(error.code==="42501"?403:error.code==="40001"?409:503);
    const parsed=z.object({
      output:z.object({id:z.literal(outputId),account_id:z.literal(account),context_generation:z.literal(generation),revision:z.literal(revision)}),
      version:z.object({revision:z.literal(revision),content:z.object({media:z.record(z.string(),reviewMediaDescriptor)})}),
    }).safeParse(data);
    if(!parsed.success)return fail(404);
    const descriptor=parsed.data.version.content.media[slot];
    if(!descriptor||(slot==="video")!==(descriptor.format==="mp4"))return fail(404);
    const path=reviewMediaKey(account,generation,outputId,revision,slot,descriptor.format);
    const blob=await deps.download(path,descriptor.bytes);
    if(!blob||blob.size!==descriptor.bytes)return fail(503);
    const bytes=new Uint8Array(await blob.arrayBuffer());
    if(createHash("sha256").update(bytes).digest("hex")!==descriptor.sha256)return fail(503);
    // Small private previews support byte ranges for native video seeking. No shared cache.
    const range=request.headers.get("range");let start=0,end=bytes.length-1,status=200;
    if(range){
      const parts=/^bytes=(\d*)-(\d*)$/.exec(range);
      if(!parts||(!parts[1]&&!parts[2]))return new Response(null,{status:416,headers:{...headers,"content-range":`bytes */${bytes.length}`}});
      if(parts[1]){start=Number(parts[1]);end=parts[2]?Math.min(Number(parts[2]),end):end;}
      else start=Math.max(0,bytes.length-Number(parts[2]));
      if(!Number.isSafeInteger(start)||!Number.isSafeInteger(end)||start>end||start>=bytes.length)return new Response(null,{status:416,headers:{...headers,"content-range":`bytes */${bytes.length}`}});
      status=206;
    }
    return new Response(bytes.slice(start,end+1),{status,headers:{...headers,"content-type":mime[descriptor.format],"content-length":String(end-start+1),"accept-ranges":"bytes",...(status===206?{"content-range":`bytes ${start}-${end}/${bytes.length}`}:{})}});
  }catch{return fail(503);}
}
