import { useState } from "react";
import { createRoot } from "react-dom/client";
import ClientWorkspace from "../../src/components/platform/ClientWorkspace";
import { accountInitialState, type View } from "../../src/lib/platform/state";
import type { PlatformVals } from "../../src/lib/platform/derive";
import "../../src/app/globals.css";

function Fixture() {
  const [state, setState] = useState({ ...accountInitialState(), onboarded: true, setupFlow: "home" as const, contextGeneration: 1, automationPaused: false });
  const nav = (view: View) => () => setState(s => ({ ...s, view }));
  const V = { goToday: nav("today"), goSystems: nav("systems"), goConnectors: nav("connectors"), goChannels: nav("channels"), goStrategy: nav("strategy"), openRoutineById: nav("systems") } as unknown as PlatformVals;
  return <ClientWorkspace S={state} V={V} account={{ mode: "account", accountId: "00000000-0000-4000-8000-000000000001", role: "owner", accountName: "Fixture business — NOT LIVE", userEmail: "fixture@example.test", autosave: "saved", error: null, setAccountName() {}, retry() {} }} send={({ text }) => setState(s => ({ ...s, messages: [...s.messages, { from: "u", text }, { from: "j", text: "Synthetic response. Nothing executed." }] }))} onModels={() => {}} onSkills={() => {}} onContext={() => {}} legacy={<h1>Existing {state.view} controls</h1>} />;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
