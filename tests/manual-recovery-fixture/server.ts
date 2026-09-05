import type { IncomingMessage, ServerResponse } from "node:http";

/** Isolated UI fixture only. Does not import database clients, env, models or providers. */
export function manualFixture() {
  let actorId="owner-a",mode="after-prepare",paused=false,settingsChanged=false,claims=0,prepares=0;
  const requests=new Map<string,{phase:string;status:string;routineId:string;purpose:string}>();
  return async (req:IncomingMessage,res:ServerResponse,next:()=>void)=>{
    if(!req.url?.startsWith("/fixture/control") && !["/api/routines/run","/api/routines/request"].some(p=>req.url?.startsWith(p)))return next();
    const json=(value:unknown,status=200)=>{res.statusCode=status;res.setHeader("content-type","application/json");res.setHeader("cache-control","no-store");res.end(JSON.stringify(value));};
    const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
    let body:Record<string,string>={};try{body=JSON.parse(Buffer.concat(chunks).toString()||"{}");}catch{return json({error:"Invalid fixture request"},400);}
    if(req.url==="/fixture/control") {
      if(body.action.startsWith("owner-"))actorId=body.action;
      if(body.action==="paused" || body.action==="unpaused")paused=body.action==="paused";
      if(body.action==="settings-changed")settingsChanged=true;
      if(["before-prepare","after-prepare","lost-cancel"].includes(body.action))mode=body.action;
      return json({actorId,mode,paused,settingsChanged,prepares,claims,requests:requests.size,providerCalls:0});
    }
    if(req.headers["x-unc-actor-id"]!==actorId)return json({error:"Owner changed"},409);
    const id=body.requestId??new URL(req.url??"/","http://fixture.test").searchParams.get("requestId");
    if(!id)return json({error:"Missing identity"},400);
    const key=`${actorId}:${id}`;
    let record=requests.get(key);
    const result=()=>({accountId:"synthetic-account",contextGeneration:1,actorId,requestId:id,routineId:"D01-W01",purpose:"run",phase:record!.phase,
      run:record!.phase==="cancelled"?null:{runId:id,routineId:"D01-W01",status:record!.status,summary:record!.phase==="prepared"?"Prepared; no work started":"Synthetic completion",receipts:[]}});
    if(req.method==="GET")return record?json(result()):json({error:"Not found"},404);
    if(body.action==="cancel") {
      if(record?.phase==="claimed" || record && paused)return json({error:"Cannot cancel a claimed or paused prepared run"},409);
      record={phase:"cancelled",status:"skipped",purpose:"run",routineId:"D01-W01"};requests.set(key,record);
      if(mode==="lost-cancel")return json({error:"Simulated lost cancellation reply"},503);
      return json(result());
    }
    if(body.action==="continue") {
      if(!record || record.phase==="cancelled" || paused || settingsChanged)return json({error:"Original unavailable or context changed"},409);
      if(record.phase==="prepared"){record.phase="claimed";record.status="done";claims++;}return json(result());
    }
    if(record?.phase==="cancelled" || paused)return json({error:"Cancelled or paused"},409);
    if(!record) {
      if(mode==="before-prepare")return json({error:"Simulated failure before prepare"},503);
      record={phase:"prepared",status:"running",purpose:"run",routineId:"D01-W01"};requests.set(key,record);prepares++;
    }
    return json({error:"Simulated lost prepare reply"},503);
  };
}
