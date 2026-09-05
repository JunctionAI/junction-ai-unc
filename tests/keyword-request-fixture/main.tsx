import {useState} from "react";
import {createRoot} from "react-dom/client";
import KeywordRunPanel from "../../src/components/platform/KeywordRunPanel";
import "../../src/app/globals.css";
function Fixture(){
  const [generation,setGeneration]=useState(1),[blocked,setBlocked]=useState(false),[refresh,setRefresh]=useState(0);
  return <main style={{maxWidth:850,padding:16}}><h1>Synthetic keyword request fixture</h1>
    <button onClick={()=>setGeneration(n=>n+1)}>Change business context</button><button onClick={()=>setBlocked(b=>!b)}>Toggle setup hold</button>
    <KeywordRunPanel context={{accountId:"aa5cfc84-2569-4c99-9b40-67003ae55eda",actorId:"74802c60-149a-4405-b719-dc058d174072",contextGeneration:generation}}
      selection={{market:"US",version:2,stateUpdatedAt:"2026-09-06T00:00:00.123456+00:00"}} blockReason={blocked?"Automation is paused.":null} onDone={()=>setRefresh(n=>n+1)}/>
    <p>Result refreshes: {refresh}</p></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
