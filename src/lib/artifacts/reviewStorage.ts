import type {SupabaseClient} from '@supabase/supabase-js';
import {boundedReviewBlob,REVIEW_BUCKET} from './reviewMedia';
export {uploadReviewMedia} from './reviewUpload';

/** Server-only adapter. Absence is recognized narrowly; auth/network errors are
 * not treated as a missing object and cannot authorize a replacement upload. */
export function reviewStorage(client:Pick<SupabaseClient,'storage'>){
  return {
    async isPrivate(){const {data,error}=await client.storage.getBucket(REVIEW_BUCKET);if(error)throw new Error('Review bucket lookup failed');return data?.public===false;},
    async read(path:string,maxBytes:number){
      const {data,error}=await client.storage.from(REVIEW_BUCKET).download(path,{}, {signal:AbortSignal.timeout(15000),cache:'no-store'}).asStream();
      if(error){if('statusCode' in error&&String(error.statusCode)==='404')return null;throw new Error('Review object read failed');}
      if(!data)throw new Error('Review object read unavailable');
      const blob=await boundedReviewBlob(data,maxBytes);
      if(!blob)throw new Error('Review object exceeds declared size');
      return new Uint8Array(await blob.arrayBuffer());
    },
    async create(path:string,bytes:Uint8Array,contentType:string){
      const {error}=await client.storage.from(REVIEW_BUCKET).upload(path,bytes,{upsert:false,contentType,cacheControl:'0'});
      if(error)throw new Error('Review upload not confirmed');
    },
  };
}
