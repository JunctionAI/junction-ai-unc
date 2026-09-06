import { z } from "zod";
import { requireAccountOwnerSession } from "@/lib/db/session";
import { captureArtifactContext, artifactFailure } from "@/lib/artifacts/context";
import { unwrap, type Row } from "@/lib/db/types";
import { queueSeoPackage } from "@/worker/seoPackages";

export const dynamic="force-dynamic";
const json=(data:unknown,status=200)=>Response.json(data,{status,headers:{"cache-control":"private, no-store"}});
const schema=z.discriminatedUnion("operation",[
  z.object({operation:z.literal("settings"),enabled:z.boolean(),prepareArticles:z.boolean(),preparePageEdits:z.boolean()}).strict(),
  z.object({operation:z.literal("run"),keywordArtifactId:z.uuid()}).strict(),
  z.object({operation:z.literal("retry"),packageId:z.uuid()}).strict(),
]);
async function handle(req:Request,write:boolean){
  try{
    const session=await requireAccountOwnerSession(req);if(session instanceof Response)return session.status===200?json({error:"Live account required"},503):session;
    const scope=await captureArtifactContext(session.service,session.accountId,req);if(scope instanceof Response)return scope;
    if(write){
      const body=schema.safeParse(await req.json().catch(()=>null));if(!body.success)return json({error:"Invalid SEO request"},400);
      if(process.env.UNC_SEO_PACKAGES_ENABLED!=="true" && !(body.data.operation==="settings"&&!body.data.enabled))return json({error:"SEO packages are not released yet"},409);
      if(body.data.operation==="settings"){
        await unwrap("seo.settings.save",session.service.from("seo_package_settings").upsert({account_id:scope.accountId,context_generation:scope.contextGeneration,actor_id:session.userId,enabled:body.data.enabled,prepare_articles:body.data.prepareArticles,prepare_page_edits:body.data.preparePageEdits},{onConflict:"account_id"}));
      }else if(body.data.operation==="retry"){
        await unwrap("seo.retry",session.service.from("seo_work_packages").update({status:"queued",attempt:2}).eq("id",body.data.packageId).eq("account_id",scope.accountId).eq("context_generation",scope.contextGeneration).eq("actor_id",session.userId).eq("status","needs").eq("attempt",1).select("id").single());
      }else await queueSeoPackage(session.service,scope.accountId,scope.contextGeneration,body.data.keywordArtifactId);
    }
    const [settings,packages,keywords]=await Promise.all([
      unwrap<Row|null>("seo.settings.read",session.service.from("seo_package_settings").select("enabled,prepare_articles,prepare_page_edits").eq("account_id",scope.accountId).eq("context_generation",scope.contextGeneration).maybeSingle()),
      unwrap<Row[]>("seo.packages",session.service.from("seo_work_packages").select("id,status,attempt,market,result,created_at,started_at,finished_at").eq("account_id",scope.accountId).eq("context_generation",scope.contextGeneration).order("created_at",{ascending:false}).limit(5)),
      unwrap<Row[]>("seo.keywords",session.service.from("artifacts").select("id,title").eq("account_id",scope.accountId).eq("routine_id","D03-W01").order("created_at",{ascending:false}).limit(1)),
    ]);
    return json({...scope,settings,packages,keyword:keywords[0]??null,released:process.env.UNC_SEO_PACKAGES_ENABLED==="true"});
  }catch(err){return artifactFailure(err);}
}
export const GET=(req:Request)=>handle(req,false);
export const POST=(req:Request)=>handle(req,true);
