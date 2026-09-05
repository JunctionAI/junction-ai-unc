import type { AccountChoice } from "@/lib/db/accountChoices";
import { accountPagePath } from "@/lib/db/accountRequest";

export default function AccountPicker({ choices, error }: { choices: AccountChoice[]; error?: string | null }) {
  return <main style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 24, background: "var(--cream)", color: "var(--ink)" }}>
    <section style={{ maxWidth: 560, width: "100%", padding: 28, borderRadius: 18, background: "white", border: "1px solid var(--line)" }}>
      <h1>Choose your client workspace</h1>
      <p>Each client has its own connections, routines and work inbox.</p>
      {error && <p role="alert">{error}</p>}
      <nav aria-label="Your client workspaces" style={{ display: "grid", gap: 12 }}>
        {choices.map(choice => <a key={choice.accountId} href={accountPagePath(choice.accountId)} style={{ padding: 14, border: "1px solid var(--line)", borderRadius: 10 }}>
          {choice.name} <small>· {choice.role === "member" ? "Read-only member" : "Owner"} · {choice.accountId.slice(-6)}</small>
        </a>)}
      </nav>
      {!choices.length && <p><a href="/app">Reload client access</a></p>}
      <form action="/auth/signout" method="post" style={{ marginTop: 20 }}><button type="submit">Sign out</button></form>
    </section>
  </main>;
}
