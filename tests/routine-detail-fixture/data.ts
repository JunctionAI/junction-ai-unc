import {agentsFixture} from "../agents-fixture/data";
import {catalogSpec} from "../../src/lib/runtime/catalog-specs";
import {resolvePreset} from "../../src/lib/runtime/presets/industry";
import {optionalSteps,relevantFields} from "../../src/lib/runtime/presets/routines";

// Closed, synthetic fixture. It never reads account credentials or provider data.
export function detailFixture() {
  const data=structuredClone(agentsFixture);
  data.paused=true;
  const row=data.routines.find(r=>r.routineId==="D01-W01")!;
  row.version=3;row.stateUpdatedAt="2026-09-05T12:00:00.000Z";
  const spec=structuredClone(catalogSpec(row.routineId));spec.version=3;
  const trigger=spec.nodes.find(n=>n.kind==="trigger");if(trigger?.kind==="trigger")trigger.cadence="manual";
  return {...data,spec,lastRunReceipts:[]};
}
export function paramsFixture() {
  const data=detailFixture();const set=resolvePreset({businessType:"ecommerce",category:"supplements",currency:"NZD",aov:100,grossMarginPct:60,budgetMonthly:3000},"content");
  const relevant=new Set(relevantFields(data.spec.id));
  return {accountId:data.accountId,contextGeneration:1,role:"owner",routineId:data.spec.id,domain:set.domain,currency:"NZD",band:set.band,
    fields:set.fields.map(f=>({...f,relevant:relevant.has(f.key),bound:false})),steps:optionalSteps(data.spec).map(s=>({...s,included:true})),
    version:{live:3,draft:null},stateUpdatedAt:data.routines.find(r=>r.routineId===data.spec.id)!.stateUpdatedAt,canPromote:false};
}
