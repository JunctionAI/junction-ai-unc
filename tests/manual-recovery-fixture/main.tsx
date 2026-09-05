import { useState } from "react";
import { createRoot } from "react-dom/client";
import ManualRecovery, { useManualRecovery } from "../../src/components/platform/ManualRecovery";

function Case({actorId}:{actorId:string}) {
  const recovery=useManualRecovery({accountId:"synthetic-account",contextGeneration:1,actorId},"D01-W01","run");
  const [message,setMessage]=useState("No request sent"),[busy,setBusy]=useState(false);
  async function submit() {
    setBusy(true);
    try { const r=await recovery.submit("/api/routines/run",{routineId:"D01-W01",syntheticPrivateAnswer:"Must never enter browser storage"});setMessage(String((r.run as {summary:string}).summary)); }
    catch(e) { setMessage(e instanceof Error?e.message:String(e)); }
    finally { setBusy(false); }
  }
  return <section><p>Owner: {actorId}</p>
    <button disabled={busy||recovery.blocked} onClick={()=>void submit()}>Submit synthetic request</button>
    <p>{message}</p>
    <ManualRecovery recovery={recovery} busy={busy} onResult={r=>setMessage(String((r.run as {summary:string}).summary))}/>
    <h2>Recovered identity (no answers)</h2><pre>{JSON.stringify(recovery.journal,null,2)}</pre>
  </section>;
}
function Fixture() {
  const [actor,setActor]=useState("owner-a"),[status,setStatus]=useState("Use controls below; no real accounts or providers.");
  async function control(action:string) {
    const res=await fetch("/fixture/control",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action})});
    const data=await res.json();setStatus(JSON.stringify(data));
    if(data.actorId)setActor(data.actorId);
  }
  return <main style={{fontFamily:"system-ui",maxWidth:860,margin:"40px auto",padding:24,lineHeight:1.6}}>
    <h1>Synthetic manual recovery acceptance</h1>
    <p>Actual recovery component and browser journal. Fake in-memory API; this is not database or provider evidence.</p>
    <nav style={{display:"flex",gap:8,flexWrap:"wrap"}}>
      {[["before-prepare","Lose reply before prepare"],["after-prepare","Lose reply after prepare"],["lost-cancel","Lose cancellation reply"],
        ["paused","Pause synthetic account"],["unpaused","Unpause synthetic account"],["settings-changed","Change synthetic settings"],
        ["owner-b","Switch to owner B"],["owner-a","Switch to owner A"],["status","Read counters"]].map(([action,label])=>
        <button key={action} onClick={()=>void control(action)}>{label}</button>)}
    </nav><pre>{status}</pre><Case key={actor} actorId={actor}/>
    <p><a href="/tests/manual-recovery-fixture/index.html">Reload recovery page</a></p>
  </main>;
}
createRoot(document.getElementById("root")!).render(<Fixture/>);
