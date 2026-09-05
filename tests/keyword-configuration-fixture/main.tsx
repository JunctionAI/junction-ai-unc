import {useState} from "react";
import {createRoot} from "react-dom/client";
import KeywordConfigurationPanel from "../../src/components/platform/KeywordConfigurationPanel";
import {keywordFixture} from "./data";
import "../../src/app/globals.css";
function Fixture(){
  const [context,setContext]=useState({accountId:keywordFixture.accountId,actorId:keywordFixture.actorId,contextGeneration:1});
  const [saves,setSaves]=useState(0);
  return <main style={{maxWidth:850,padding:16}}><h1>Synthetic keyword setup fixture</h1>
    <button onClick={()=>setContext(c=>({...c,contextGeneration:c.contextGeneration+1}))}>Change business context</button>
    <KeywordConfigurationPanel context={context} onSaved={()=>setSaves(n=>n+1)}/><p>Confirmed saves: {saves}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
