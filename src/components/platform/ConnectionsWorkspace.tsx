"use client";
import { useState } from "react";
import type { PlatformVals } from "@/lib/platform/derive";
import ConnectorsView from "./ConnectorsView";
import ChannelsSettings from "./ChannelsSettings";
import styles from "./connections.module.css";
export default function ConnectionsWorkspace({V}:{V:PlatformVals}) {
  const [tab,setTab]=useState("Data platforms");
  return <div className={styles.content}>
    <h1>Connections</h1><p>Where your agents read from, and where reviewed work can reach you. Connecting an account does not itself verify a data read or message delivery.</p>
    <div className={styles.tabs} role="group" aria-label="Connection type">{["Data platforms","Messaging"].map(t=><button key={t} aria-pressed={tab===t} onClick={()=>setTab(t)}>{t}</button>)}</div>
    {tab==="Data platforms"?<ConnectorsView V={V} modern/>:<div className={styles.channels}>
      <p className={styles.notice}>Customer messaging remains disabled. Saved channel links and preferences are setup records, not proof of delivered replies. Deep Slack routing, digest and escalation capabilities still require acceptance; no prototype switches are enabled here.</p>
      <ChannelsSettings/>
    </div>}
  </div>;
}
