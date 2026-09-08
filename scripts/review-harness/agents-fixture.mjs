// UI fixture only. Not real auth, native confirmation or deployed API proof.
const account='00000000-0000-4000-8000-000000000001';
let revision=0,enabled=false,time='08:00',timezone='Pacific/Auckland',updatedAt=new Date().toISOString();
function routine(){return {routineId:'D02-W01',enabled,version:1,stateUpdatedAt:updatedAt,selectionBlock:null,
 availabilityCopy:'LOCAL TEST — external configuration fixture',canEnable:true,skillSource:'builtin',
 external:{revision,schedule:{time,timezone},status:revision?'queued':'off',teamActionRequired:false,
 message:revision?'Settings saved. Waiting for your agent to receive them.':'Agent is off. No schedule has been requested.'}};}
export async function agentsFixture(request){
 if(request.headers.get('x-unc-account-id')!==account||request.headers.get('x-unc-context-generation')!=='1')return Response.json({error:'Fixture account mismatch'},{status:403});
 if(request.method==='POST'){
  const b=await request.json();
  if(b.routineId!=='D02-W01'||b.external?.revision!==revision)return Response.json({error:'Stale fixture'},{status:409});
  revision++;enabled=b.enabled;time=b.external.schedule.time;timezone=b.external.schedule.timezone;updatedAt=new Date().toISOString();
  return Response.json({saved:{accountId:account,contextGeneration:1,...routine()}});
 }
 return Response.json({accountId:account,contextGeneration:1,actorId:account,role:'owner',paused:false,routines:[routine()]});
}
