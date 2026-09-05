import { useState } from "react";
import { createRoot } from "react-dom/client";
import CalendarPreferencesPanel from "../../src/components/platform/CalendarPreferencesPanel";
import "../../src/app/globals.css";
function Fixture() {
  const [context, setContext] = useState({ accountId: "aa5cfc84-2569-4c99-9b40-67003ae55eda", actorId: "74802c60-149a-4405-b719-dc058d174072", contextGeneration: 1 });
  return <main style={{ maxWidth: 850, padding: 16 }}><h1>Synthetic calendar settings</h1>
    <button onClick={() => setContext(c => ({ ...c, contextGeneration: c.contextGeneration + 1 }))}>Change business context</button>
    <CalendarPreferencesPanel context={context} /></main>;
}
createRoot(document.getElementById("root")!).render(<Fixture />);
