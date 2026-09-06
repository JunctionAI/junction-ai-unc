/** One explicit AVGAR package test, using the same persisted worker path. */
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {createClient}=require('@supabase/supabase-js');
const {queueSeoPackage,runSeoPackagesTick}=require('../dist/worker/worker/seoPackages.js');
if(process.argv[2]!=='--run-once')throw Error('Explicit test flag required');
const db=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL,process.env.SUPABASE_SERVICE_ROLE_KEY,{auth:{persistSession:false,autoRefreshToken:false}});
const A='aa5cfc84-2569-4c99-9b40-67003ae55eda',U='74802c60-149a-4405-b719-dc058d174072',K='ea33a35b-5c1f-4b70-8678-18e56ac86621';
const existing=await db.from('seo_work_packages').select('account_id').in('status',['queued','running']);
if(existing.error||existing.data.some(p=>p.account_id!==A))throw Error('Another account has pending work; use the normal worker');
const settings=await db.from('seo_package_settings').upsert({account_id:A,context_generation:1,actor_id:U,enabled:true,prepare_articles:true,prepare_page_edits:true},{onConflict:'account_id'});
if(settings.error)throw Error('Could not enable approved AVGAR package test');
const job=await queueSeoPackage(db,A,1,K);
console.log(JSON.stringify({id:job.id,status:job.status}));
if(job.status==='queued')await runSeoPackagesTick(db,{...process.env,UNC_SEO_PACKAGES_ENABLED:'true'});
const result=await db.from('seo_work_packages').select('id,status,result').eq('id',job.id).single();
if(result.error)throw Error('Could not independently read saved package');
console.log(JSON.stringify({id:result.data.id,status:result.data.status,items:result.data.result?.artifact?.items?.length,needs:result.data.result?.needs,published:false}));
