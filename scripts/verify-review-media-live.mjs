// Explicit storage-only test: no account/routine/database creation or client operations.
import {readFile} from 'node:fs/promises';
import {pathToFileURL} from 'node:url';
import {randomUUID} from 'node:crypto';
import {createClient} from '@supabase/supabase-js';
process.loadEnvFile('.env.local');
const url=process.env.NEXT_PUBLIC_SUPABASE_URL;
if(new URL(url).hostname!=='ycgayfsvcjpsnryrpukv.supabase.co')throw new Error('Unexpected project');
const client=createClient(url,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const bucket='junction-review-private';
const lookup=await client.storage.getBucket(bucket);
if(lookup.error){
  if(String(lookup.error.statusCode)!=='404'||process.env.REVIEW_CREATE_PRIVATE_BUCKET!=='true')throw new Error('Private test bucket unavailable');
  const created=await client.storage.createBucket(bucket,{public:false,fileSizeLimit:25*1024*1024,allowedMimeTypes:['image/png','image/jpeg','image/webp','video/mp4']});
  if(created.error)throw new Error('Bucket creation not confirmed');
}
const {reviewStorage,uploadReviewMedia}=await import(pathToFileURL(process.env.REVIEW_STORAGE_BUNDLE).href);
const bytes=new Uint8Array(await readFile(process.env.REVIEW_TEST_IMAGE));
// Storage-only fixture IDs; not claimed as real accounts or registered outputs.
const accountId=randomUUID(),outputId=randomUUID();
const output={ref:{accountId,artifactId:randomUUID(),outputId,revision:0},kind:'email',sectionIds:[],durationSeconds:null};
const storage=reviewStorage(client);
const saved=await uploadReviewMedia(output,0,'image','png',bytes,storage);
const replay=await uploadReviewMedia(output,0,'image','png',bytes,storage);
const publicRead=await fetch(`${url}/storage/v1/object/public/${bucket}/${saved.path}`,{redirect:'error',signal:AbortSignal.timeout(10000)});
if(publicRead.ok)throw new Error('Private test object is publicly readable');
console.log(JSON.stringify({status:'PASS',scope:'real private Supabase storage only; fixture IDs, not client or runtime proof',bucket,path:saved.path,bytes:saved.descriptor.bytes,sha256:saved.descriptor.sha256,replayDuplicate:replay.duplicate,unauthenticatedPublicStatus:publicRead.status}));
