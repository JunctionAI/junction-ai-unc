import type {AgentsSnapshot} from "../../src/lib/agents/types";
import {AGENT_JOBS} from "../../src/lib/agents/catalog";
import {modelFromProfile} from "../../src/lib/unc/businessType";
export const agentsFixture:AgentsSnapshot={actorId:"owner-a",accountId:"00000000-0000-4000-8000-000000000001",contextGeneration:1,fetchedAt:"2026-09-05T11:30:00Z",role:"owner",paused:false,
  connected:[],business:modelFromProfile(null),recommendedFirst:[],planChannel:null,
  routines:AGENT_JOBS.filter(j=>j.routineId).map(j=>({routineId:j.routineId!,name:j.label,category:j.area,wave:1,enabled:false,version:1,
    availability:"ready",availabilityCopy:"Synthetic draft eligibility, not live evidence",canEnable:true,betterWith:[],betterWithCopy:null,recommended:false,lastRun:null,lastDraft:null,skillSource:"builtin",stateUpdatedAt:null,
    selectionBlock:j.routineId==="D03-W01"?"Keyword pilot requires independent verification.":null})),
};
