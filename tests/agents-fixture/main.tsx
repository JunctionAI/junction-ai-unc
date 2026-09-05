import {useState} from "react";
import {createRoot} from "react-dom/client";
import AgentsView from "../../src/components/platform/AgentsView";
import ConnectionsWorkspace from "../../src/components/platform/ConnectionsWorkspace";
import {derive} from "../../src/lib/platform/derive";
import {accountInitialState,type PlatformState} from "../../src/lib/platform/state";
import {agentsFixture} from "./data";
import "../../src/app/globals.css";
import workspaceStyles from "../../src/components/platform/client-workspace.module.css";
function Fixture(){
  const [tab,setTab]=useState("Agents");const [inspection,setInspection]=useState("");
  const [s,set]=useState<PlatformState>({...accountInitialState(),onboarded:true,setupFlow:"home",contextGeneration:1});
  const V=derive(s,patch=>set(old=>({...old,...(typeof patch==="function"?patch(old):patch)})),undefined,undefined,{mode:"account"});
  return <div className={`${workspaceStyles.workspace} unc-platform`}><aside className={workspaceStyles.sidebar}><nav><button onClick={()=>{setTab("Agents");setInspection("");}}>Agents</button><button onClick={()=>setTab("Connections")}>Connections</button></nav></aside><main className={workspaceStyles.main}>
    {tab==="Agents"?<><AgentsView accountId={agentsFixture.accountId} contextGeneration={1} onInspect={setInspection} onSaved={V.setRoutineLocal}/>{inspection&&<p>Inspector target: {inspection}</p>}</>:<ConnectionsWorkspace V={V}/>}</main></div>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
