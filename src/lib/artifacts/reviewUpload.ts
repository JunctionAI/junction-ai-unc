import {createHash} from "node:crypto";
import {reviewOutputSchema,type ReviewOutput} from "./reviewContract";
import {reviewMediaDescriptor,reviewMediaKey} from "./reviewMedia";

type Store={
  isPrivate:()=>Promise<boolean>;
  read:(path:string,maxBytes:number)=>Promise<Uint8Array|null>;
  /** Must use create-only semantics, never overwrite an existing object. */
  create:(path:string,bytes:Uint8Array,contentType:string)=>Promise<void>;
};
const types={png:'image/png',jpeg:'image/jpeg',webp:'image/webp',mp4:'video/mp4'};
/** Upload readback is mandatory even if create times out. This function never retries
 * the write; a matching already-present object is an idempotent success. */
export async function uploadReviewMedia(output:ReviewOutput,generation:number,slot:'image'|'video',format:keyof typeof types,bytes:Uint8Array,store:Store){
  reviewOutputSchema.parse(output);
  if(!Number.isSafeInteger(generation)||generation<0)throw new Error('Invalid generation');
  const descriptor=reviewMediaDescriptor.parse({format,bytes:bytes.byteLength,sha256:createHash('sha256').update(bytes).digest('hex')});
  if((slot==='video')!==(format==='mp4'))throw new Error('Media slot mismatch');
  if(!await store.isPrivate())throw new Error('Review storage must be private');
  const path=reviewMediaKey(output.ref.accountId,generation,output.ref.outputId,output.ref.revision,slot,format);
  const matches=(value:Uint8Array)=>value.byteLength===descriptor.bytes&&createHash('sha256').update(value).digest('hex')===descriptor.sha256;
  const existing=await store.read(path,descriptor.bytes);
  if(existing){if(!matches(existing))throw new Error('Immutable media conflict');return {descriptor,path,duplicate:true};}
  try{await store.create(path,bytes,types[format]);}catch{/* A timeout may still have committed. Read before deciding. */}
  const saved=await store.read(path,descriptor.bytes);
  if(!saved||!matches(saved))throw new Error('Media upload not verified');
  return {descriptor,path,duplicate:false};
}
