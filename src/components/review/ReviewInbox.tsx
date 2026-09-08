'use client';
import {useEffect,useState} from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {reviewInboxSchema,type ReviewInbox as Inbox} from '@/lib/artifacts/reviewInbox';
import {useAccountRequest} from '../platform/AccountScope';
import styles from './inbox.module.css';

export default function ReviewInbox({accountId,generation}:{accountId:string;generation:number}){
 const request=useAccountRequest();
 const [query,setQuery]=useState<{cursor:Inbox['nextCursor'];tick:number}>({cursor:null,tick:0});
 const [data,setData]=useState<Inbox|null>(null),[available,setAvailable]=useState(true),[loading,setLoading]=useState(true),[error,setError]=useState<string|null>(null);
 useEffect(()=>{
  const controller=new AbortController();let cancelled=false;
  const timeout=setTimeout(()=>controller.abort(),20000);
  const cursor=query.cursor;
  void (async()=>{
  try{
   const query=cursor?`?beforeAt=${encodeURIComponent(cursor.createdAt)}&beforeId=${cursor.id}`:'';
   const response=await request(`/api/review/inbox${query}`,{cache:'no-store',signal:controller.signal,headers:{'x-unc-context-generation':String(generation)}});
   const raw=await response.json();if(cancelled)return;
   if(!response.ok)throw new Error('Could not load saved review work. Please retry.');
   if(raw.available===false){setAvailable(false);setData(null);return;}
   const page=reviewInboxSchema.parse(raw);
   if(page.accountId!==accountId||page.contextGeneration!==generation||page.items.some(i=>i.accountId!==accountId))throw new Error('Business context changed. Reload this page.');
   setAvailable(true);setData(prior=>cursor&&prior?{...page,items:[...prior.items,...page.items.filter(i=>!prior.items.some(p=>p.id===i.id))]}:page);
  }catch{if(!cancelled)setError('Could not verify saved review work. Refresh to try again.');}
  finally{clearTimeout(timeout);if(!cancelled)setLoading(false);}
  })();
  return()=>{cancelled=true;clearTimeout(timeout);controller.abort();};
 },[accountId,generation,request,query]);
 const refresh=(cursor:Inbox['nextCursor']=null)=>{setLoading(true);setError(null);setQuery(q=>({cursor,tick:q.tick+1}));};
 if(!available)return null;
 return <section className={styles.inbox} aria-label="Review desk">
  <header><div><h2>Your review desk</h2><p>Saved work to open, comment on and review. Approval and execution status are shown inside.</p></div><button disabled={loading} onClick={()=>refresh()}>{loading?'Loading…':'Refresh work'}</button></header>
  {error&&<p role="alert">{error}</p>}
  {!data&&loading&&<p role="status">Loading this account’s saved outputs…</p>}
  {data?.items.length===0&&!loading&&<p>No finished outputs have been saved in this business context yet.</p>}
  <div className={styles.grid}>{data?.items.map(item=>{
   const query=`account=${accountId}&generation=${generation}&revision=${item.revision}`;
   return <article key={item.id}><small>{item.kind} · version {item.revision+1}</small><h3>{item.title}</h3>
    {item.image?<Image unoptimized src={`/api/review/media/${item.id}_image?${query}`} alt={item.title} width={640} height={400}/>:item.video?<p className={styles.video}>Video ready to preview</p>:null}
    {item.excerpt&&<p>{item.excerpt}</p>}
    <Link href={`/app/review/${item.id}?account=${accountId}`}>Open &amp; review →</Link>
   </article>;
  })}</div>
  {data?.nextCursor&&<button disabled={loading} onClick={()=>refresh(data.nextCursor)}>Load older work</button>}
 </section>;
}
