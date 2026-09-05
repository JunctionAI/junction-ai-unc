import { useState } from "react";
import { createRoot } from "react-dom/client";
import SlackRouteSetupPanel from "../../src/components/platform/SlackRouteSetupPanel";
import "../../src/app/globals.css";
function Fixture() {
  const [context,setContext]=useState({accountId:"aa5cfc84-2569-4c99-9b40-67003ae55eda",contextGeneration:1});
  return <main style={{maxWidth:850,padding:16}}><h1>Synthetic Slack setup</h1>
    <button onClick={()=>setContext(c=>({...c,contextGeneration:c.contextGeneration+1}))}>Change business context</button>
    <SlackRouteSetupPanel context={context}/></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
