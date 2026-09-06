"use client";
import { useEffect, useState } from "react";
import { artifactHeaders } from "@/lib/artifacts/client";

interface Saved { revision:number; enabled:boolean; timezone:string; hour:number; minute:number; weekday:number|null; on_date:string|null; channel:string }
export default function RoutineSchedulePanel({accountId,contextGeneration}:{accountId:string;contextGeneration:number}){
 const [saved,setSaved]=useState<Saved|null>(null),[loaded,setLoaded]=useState(false),[busy,setBusy]=useState(false),[message,setMessage]=useState("");
 const [time,setTime]=useState("09:00"),[zone,setZone]=useState("Pacific/Auckland"),[day,setDay]=useState("1");
 const [destination,setDestination]=useState<string|null>(null),[slack,setSlack]=useState(true),[reload,setReload]=useState(0);
 useEffect(()=>{let cancelled=false;
   fetch("/api/routines/schedule?routineId=D03-W01",{cache:"no-store",headers:artifactHeaders(accountId,contextGeneration)})
    .then(async r=>{const b=await r.json();if(cancelled)return;
      if(!r.ok||b.accountId!==accountId||b.contextGeneration!==contextGeneration)throw Error(b.error||"Schedule could not be verified");
      const s=b.schedule as Saved|null;setSaved(s);setDestination(b.deliveryCommandId??null);
      if(s){setTime(`${String(s.hour).padStart(2,"0")}:${String(s.minute).padStart(2,"0")}`);setZone(s.timezone);setDay(s.weekday===null?"daily":String(s.weekday));setSlack(s.channel==="slack");}
      setLoaded(true);
    }).catch(e=>{if(!cancelled)setMessage(e.message);});
   return()=>{cancelled=true;};
 },[accountId,contextGeneration,reload]);
 async function save(enabled:boolean){
   if(!loaded||busy)return;setBusy(true);setMessage("");
   const [hour,minute]=time.split(":").map(Number);
   try{const r=await fetch("/api/routines/schedule",{method:"POST",headers:{"content-type":"application/json",...artifactHeaders(accountId,contextGeneration)},
     body:JSON.stringify({routineId:"D03-W01",revision:saved?.revision??null,enabled,timezone:zone,hour,minute,weekday:day==="daily"?null:Number(day),deliveryCommandId:slack?destination:null})});
     const b=await r.json();if(!r.ok||b.accountId!==accountId||b.contextGeneration!==contextGeneration)throw Error(b.error||"Save not confirmed");
     setSaved(b.schedule);setMessage(enabled?"Schedule saved. Runs use your reviewed settings; nothing is published automatically.":"Schedule stopped.");
   }catch(e){setMessage(e instanceof Error?e.message:"Save not confirmed. Reload to check.");setLoaded(false);}
   finally{setBusy(false);}
 }
 return <section style={{background:"white",border:"1px solid var(--card-border)",borderRadius:13,padding:18,marginTop:16}} aria-label="Routine schedule">
  <h3 style={{marginTop:0}}>Run automatically</h3>
  <p>{saved?.on_date?`One-off test saved for ${saved.on_date}. Saving below replaces it with a recurring schedule.`:saved?.enabled?"Automatic schedule is on.":"No ongoing schedule is active."}</p>
  <div style={{display:"flex",flexWrap:"wrap",gap:12}}>
   <label>Frequency <select aria-label="Schedule frequency" value={day} onChange={e=>setDay(e.target.value)} disabled={!loaded||busy}>
    <option value="daily">Daily</option>{["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"].map((d,i)=><option key={d} value={i}>{`Weekly — ${d}`}</option>)}
   </select></label>
   <label>Time <input aria-label="Schedule time" type="time" value={time} onChange={e=>setTime(e.target.value)} disabled={!loaded||busy}/></label>
   <label>Timezone <input aria-label="Schedule timezone" value={zone} onChange={e=>setZone(e.target.value)} disabled={!loaded||busy}/></label>
  </div>
  <label style={{display:"block",margin:"14px 0"}}><input type="checkbox" checked={slack&&!!destination} disabled={!destination||busy||!loaded} onChange={e=>setSlack(e.target.checked)}/> Send the summary to the existing verified SEO Slack thread</label>
  <button disabled={!loaded||busy} onClick={()=>save(true)}>Save recurring schedule</button>{" "}
  <button disabled={!loaded||busy||!saved?.enabled} onClick={()=>save(false)}>Stop schedule</button>{" "}
  {!loaded&&<button disabled={busy} onClick={()=>{setMessage("");setReload(n=>n+1);}}>Reload saved state</button>}
  {message&&<p role="status">{message}</p>}
 </section>;
}
