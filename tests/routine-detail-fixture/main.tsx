import {useState} from "react";
import {createRoot} from "react-dom/client";
import RoutinesView from "../../src/components/platform/RoutinesView";
import {derive} from "../../src/lib/platform/derive";
import {accountInitialState,type PlatformState} from "../../src/lib/platform/state";
import {ALL_SYSTEMS} from "../../src/lib/platform/catalog";
import {agentsFixture} from "../agents-fixture/data";
import "../../src/app/globals.css";
function Fixture(){
  const [s,set]=useState<PlatformState>({...accountInitialState(),onboarded:true,setupFlow:"home",contextGeneration:1,view:"systems",sel:ALL_SYSTEMS.find(s=>s.id==="D01-W01")!});
  const V={...derive(s,p=>set(old=>({...old,...(typeof p==="function"?p(old):p)})),undefined,undefined,{mode:"account"}),accountId:agentsFixture.accountId};
  return <main className="unc-platform"><RoutinesView V={V} run={{accountId:agentsFixture.accountId,account:{currency:"NZD",budgetMonthly:0},persisted:true}}/></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
