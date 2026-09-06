import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { rowToArtifact } from "../lib/runtime/store/supabase";
import { readSeoSiteSources } from "../lib/runtime/seoSources";
import { produceSeoDraft } from "../lib/runtime/seoDraft";
import { createTextClient } from "../lib/llm/router";

export async function queueSeoPackage(db: DbClient, accountId: string, generation: number, artifactId: string) {
  const settings = await unwrap<Row|null>("seo.settings",db.from("seo_package_settings").select("*").eq("account_id",accountId).eq("context_generation",generation).eq("enabled",true).maybeSingle());
  if (!settings) throw Error("Enable SEO draft preparation first");
  const a = await unwrap<Row>("seo.keyword",db.from("artifacts").select("*").eq("account_id",accountId).eq("id",artifactId).single());
  const meta=a.meta as {executionReceipt?:{client?:{locationCode?:number;primaryDomain?:string}}};
  const client=meta.executionReceipt?.client;
  const market=({2840:"US",2554:"NZ",2036:"AU"} as Record<number,string>)[client?.locationCode??0];
  if(!market || !client?.primaryDomain || !/^[a-z0-9.-]+$/.test(client.primaryDomain))throw Error("Verified keyword market unavailable");
  const prior=await unwrap<Row|null>("seo.existing",db.from("seo_work_packages").select("*").eq("account_id",accountId).eq("context_generation",generation).eq("keyword_artifact_id",artifactId).eq("keyword_revision",a.revision??0).maybeSingle());
  if(prior)return prior;
  return unwrap<Row>("seo.queue",db.from("seo_work_packages").insert({account_id:accountId,context_generation:generation,actor_id:settings.actor_id,
    keyword_artifact_id:artifactId,keyword_revision:a.revision??0,market,website:`https://${client.primaryDomain}/`,prepare_articles:settings.prepare_articles,prepare_page_edits:settings.prepare_page_edits}).select("*").single());
}

/** Same daemon, no second timer. Follow each newly completed keyword artifact once.
 * A running job is never retried automatically after a crash or uncertain model response. */
export async function runSeoPackagesTick(db: DbClient, env: NodeJS.ProcessEnv=process.env) {
  if(env.UNC_SEO_PACKAGES_ENABLED!=="true")return;
  const settings=await unwrap<Row[]>("seo.enabled",db.from("seo_package_settings").select("*").eq("enabled",true).limit(20));
  for(const s of settings){
    const artifacts=await unwrap<Row[]>("seo.new_keywords",db.from("artifacts").select("id").eq("account_id",s.account_id).eq("routine_id","D03-W01").gte("created_at",s.starts_at).order("created_at",{ascending:false}).limit(1));
    if(artifacts[0]){try{await queueSeoPackage(db,String(s.account_id),Number(s.context_generation),String(artifacts[0].id));}catch{/* A revoked source, selection or in-flight package must not start work. */}}
  }
  const job=await unwrap<Row|null>("seo.claim",db.rpc("claim_seo_package"));
  if(!job)return;
  const scope={accountId:String(job.account_id),contextGeneration:Number(job.context_generation),market:job.market as "US"|"NZ"|"AU",cycleId:String(job.id)};
  // Any failure after claim remains visible as running/uncertain. Never issue another model call silently.
  await assertRuntimeContext(db,scope);
  const a=await unwrap<Row>("seo.source",db.from("artifacts").select("*").eq("id",job.keyword_artifact_id).eq("account_id",scope.accountId).single());
  if(a.revision!==job.keyword_revision)throw Error("SEO source changed after admission");
  const now=new Date().toISOString();
  const sources=await readSeoSiteSources(scope,String(job.website),now);
  await assertRuntimeContext(db,scope);
  const current=await unwrap<Row|null>("seo.recheck_selection",db.from("seo_package_settings").select("*").eq("account_id",scope.accountId).eq("context_generation",scope.contextGeneration).eq("enabled",true).maybeSingle());
  if(!current || current.prepare_articles!==job.prepare_articles || current.prepare_page_edits!==job.prepare_page_edits)throw Error("SEO selection changed");
  const client=createTextClient("routine_produce",{maxTokens:6500,effort:"low",jsonMode:true},{accountId:scope.accountId,db});
  if(!client)throw Error("SEO draft model unavailable");
  const result=await produceSeoDraft({...scope,now,...sources,keywords:[{artifact:rowToArtifact(a),market:scope.market,contextGeneration:scope.contextGeneration}],prepareArticles:job.prepare_articles===true,preparePageEdits:job.prepare_page_edits===true},
    ({system,prompt})=>client.complete({system,user:prompt,accountId:scope.accountId}));
  await unwrap("seo.finish",db.from("seo_work_packages").update({status:"artifact" in result?"ready":"needs",result,finished_at:new Date().toISOString()}).eq("id",job.id).eq("status","running").select("id").single());
}
