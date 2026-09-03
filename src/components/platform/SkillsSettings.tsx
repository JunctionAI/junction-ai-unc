"use client";
/* "Skills" — which source drafts each routine's produce step: my built-in skill card, or one of
   your n8n workflows. Accounts mode only (the sidebar hides the link in demo mode); the owner
   registers, tests, pauses and resumes; an admin (UNC_ADMIN_EMAILS) can make a workflow global
   and sees every account's model spend this month. Reads/writes /api/skills/n8n
   (docs/N8N-ROUTINES.md). `initial` lets tests render a listing without fetching. */

import { useEffect, useState } from "react";

export interface SkillWorkflowView {
  id: string;
  webhookUrl: string;
  active: boolean;
  global: boolean;
}

export interface SkillRowView {
  routineId: string;
  name: string;
  category: string;
  wave: 1 | 2;
  builtIn: boolean;
  produces: boolean;
  source: "n8n" | "builtin" | "none";
  workflow: SkillWorkflowView | null;
  workflows: SkillWorkflowView[];
}

export interface SkillsPayload {
  routines: SkillRowView[];
  owner: boolean;
  admin: boolean;
  secretConfigured: boolean;
  dataBaseUrl: string | null;
  budget: { spentUsd: number; capUsd: number; ok: boolean; capSource?: string };
  accounts?: { accountId: string; name: string; spentUsd: number; capUsd: number; ok: boolean }[];
}

type TestOutcome = { ok: true; kind: "artifact"; artifact: { kind: string; title: string; body: string; items: number }; ms: number } | { ok: true; kind: "needs"; needs: { platform?: string; input?: string; why: string }[]; ms: number } | { ok: true; kind: "accepted"; note: string; ms: number } | { ok: false; error: string; ms: number };

export const SKILLS_COPY = {
  title: "Who drafts what",
  intro: "Every routine that drafts has a skill behind it. Mine are built in. Paste an n8n webhook and that routine runs on your workflow instead — it gets the same material I use, reads your data through me with a run-scoped token (never its own keys), and if it doesn’t answer I draft with my built-in skill.",
  builtin: "Built-in skill",
  n8n: "Your n8n workflow",
  none: "No draft step yet",
  noSecret: "N8N_SIGNING_SECRET isn’t set on the server yet — I won’t call a workflow unsigned. Tom sets it; then this works.",
  budgetLine: (spent: number, cap: number) => `Thinking budget this month: US$${spent.toFixed(2)} of US$${cap.toFixed(2)}.`,
  budgetOut: "This month’s thinking budget is used — Tom can raise it.",
} as const;

const usd = (n: number) => `US$${n.toFixed(2)}`;

const SOURCE_LABEL: Record<SkillRowView["source"], string> = { builtin: SKILLS_COPY.builtin, n8n: SKILLS_COPY.n8n, none: SKILLS_COPY.none };
const SOURCE_STYLE: Record<SkillRowView["source"], React.CSSProperties> = {
  builtin: { background: "var(--cyan-wash)", color: "var(--cyan-link)" },
  n8n: { background: "oklch(0.95 0.05 150)", color: "oklch(0.4 0.12 150)" },
  none: { background: "oklch(0.95 0.01 90)", color: "var(--muted)" },
};

export default function SkillsSettings({ onClose, initial = null }: { onClose: () => void; initial?: SkillsPayload | null }) {
  const [data, setData] = useState<SkillsPayload | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [globals, setGlobals] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [tests, setTests] = useState<Record<string, TestOutcome | "running">>({});

  async function load() {
    try {
      const res = await fetch("/api/skills/n8n", { cache: "no-store" });
      const body = (await res.json().catch(() => ({}))) as Partial<SkillsPayload> & { fallback?: boolean; error?: string };
      if (!res.ok || body.fallback || !Array.isArray(body.routines)) setError(body.error ?? "I couldn’t load the skills just now.");
      else {
        setData(body as SkillsPayload);
        setError(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    if (initial) return;
    let cancelled = false;
    void (async () => {
      if (!cancelled) await load();
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function call(path: string, method: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetch(path, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const out = (await res.json().catch(() => ({}))) as Record<string, unknown> & { error?: string };
    if (!res.ok) throw new Error(out.error ?? `couldn’t save (${res.status})`);
    return out;
  }

  async function save(routineId: string) {
    const url = (drafts[routineId] ?? "").trim();
    if (!url) return;
    setBusy(routineId);
    setError(null);
    try {
      await call("/api/skills/n8n", "POST", { routineId, webhookUrl: url, global: !!globals[routineId] });
      setDrafts((d) => ({ ...d, [routineId]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function toggle(routineId: string, w: SkillWorkflowView) {
    setBusy(routineId);
    setError(null);
    try {
      await call("/api/skills/n8n", "PATCH", { id: w.id, active: !w.active });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }

  async function test(routineId: string, webhookUrl: string) {
    setTests((t) => ({ ...t, [routineId]: "running" }));
    try {
      const out = (await call("/api/skills/n8n/test", "POST", { routineId, webhookUrl })) as unknown as TestOutcome;
      setTests((t) => ({ ...t, [routineId]: out }));
    } catch (e) {
      setTests((t) => ({ ...t, [routineId]: { ok: false, error: e instanceof Error ? e.message : String(e), ms: 0 } }));
    }
  }

  const canEdit = !!data && (data.owner || data.admin);
  const grouped = (data?.routines ?? []).reduce<Record<string, SkillRowView[]>>((acc, r) => ((acc[r.category] ??= []).push(r), acc), {});

  return (
    <div role="dialog" aria-label="Skills" onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.03 262 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(760px, 94vw)", maxHeight: "88vh", overflow: "auto", background: "var(--cream)", color: "var(--ink)", borderRadius: 14, padding: "26px 28px 22px", boxShadow: "0 24px 60px oklch(0.2 0.03 262 / 0.35)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>Skills</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>{SKILLS_COPY.title}</h2>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
            Close
          </button>
        </div>
        <p style={{ margin: "10px 0 14px", fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>{SKILLS_COPY.intro}</p>

        {data && (
          <div data-testid="skills-budget" style={{ marginBottom: 14, fontSize: 12.5, color: data.budget.ok ? "var(--muted)" : "var(--amber-text)" }}>
            {SKILLS_COPY.budgetLine(data.budget.spentUsd, data.budget.capUsd)}
            {!data.budget.ok && <> {SKILLS_COPY.budgetOut}</>}
          </div>
        )}
        {data && !data.secretConfigured && <div data-testid="skills-no-secret" style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: "var(--amber-wash)", color: "var(--ink)", fontSize: 13, lineHeight: 1.5 }}>{SKILLS_COPY.noSecret}</div>}
        {data && !canEdit && <div style={{ marginBottom: 14, fontSize: 12.5, color: "var(--muted)" }}>Only the account owner can register or change a workflow — you can see what runs.</div>}
        {error && <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: "oklch(0.97 0.03 80)", color: "var(--ink)", fontSize: 13 }}>{error}</div>}
        {!data && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Fetching…</div>}

        {data &&
          Object.entries(grouped).map(([category, rows]) => (
            <div key={category} style={{ marginBottom: 18 }}>
              <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, margin: "6px 0 8px" }}>{category}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {rows.map((r) => {
                  const t = tests[r.routineId];
                  const urlDraft = drafts[r.routineId] ?? "";
                  return (
                    <div key={r.routineId} data-testid={`skill-${r.routineId}`} data-source={r.source} style={{ padding: "12px 14px", borderRadius: 11, background: "oklch(0.985 0.01 90)", border: "1px solid oklch(0.92 0.01 90)" }}>
                      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
                        <span style={{ fontSize: 14, fontWeight: 600 }}>{r.name}</span>
                        <span style={{ fontSize: 10, color: "var(--muted)", fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>{r.routineId}</span>
                        <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase", borderRadius: 5, padding: "2px 7px", ...SOURCE_STYLE[r.source] }}>{SOURCE_LABEL[r.source]}</span>
                        {r.wave === 2 && !r.produces && <span style={{ fontSize: 11, color: "var(--muted)" }}>wave 2 — no draft step until then</span>}
                      </div>
                      {r.workflows.length > 0 && (
                        <div style={{ display: "flex", flexDirection: "column", gap: 4, marginTop: 8 }}>
                          {r.workflows.map((w) => (
                            <div key={w.id} data-testid={`workflow-${w.id}`} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 12, color: "var(--muted-2)", flexWrap: "wrap" }}>
                              <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", maxWidth: 360 }} title={w.webhookUrl}>
                                {w.webhookUrl}
                              </span>
                              <span>{w.global ? "every account" : "this account"}</span>
                              <span style={{ color: w.active ? "oklch(0.4 0.12 150)" : "var(--muted)" }}>{w.active ? "active" : "paused"}</span>
                              {canEdit && (!w.global || data.admin) && (
                                <button type="button" disabled={busy === r.routineId} onClick={() => void toggle(r.routineId, w)} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", cursor: "pointer", fontSize: 12, padding: 0 }}>
                                  {w.active ? "Pause" : "Activate"}
                                </button>
                              )}
                              {canEdit && (
                                <button type="button" disabled={t === "running"} onClick={() => void test(r.routineId, w.webhookUrl)} className="hov-underline" style={{ border: "none", background: "transparent", color: "var(--cyan-link)", cursor: "pointer", fontSize: 12, padding: 0 }}>
                                  Test
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                      {canEdit && (
                        <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                          <input
                            aria-label={`Webhook URL for ${r.name}`}
                            value={urlDraft}
                            placeholder="https://your-n8n/webhook/…"
                            onChange={(e) => setDrafts((d) => ({ ...d, [r.routineId]: e.target.value }))}
                            style={{ flex: 1, minWidth: 260, fontSize: 12.5, padding: "7px 10px", borderRadius: 8, border: "1px solid oklch(0.85 0.02 262)", background: "white", color: "var(--ink)" }}
                          />
                          {data.admin && (
                            <label style={{ fontSize: 11.5, color: "var(--muted)", display: "flex", alignItems: "center", gap: 5 }}>
                              <input type="checkbox" checked={!!globals[r.routineId]} onChange={(e) => setGlobals((g) => ({ ...g, [r.routineId]: e.target.checked }))} /> every account
                            </label>
                          )}
                          <button type="button" disabled={!urlDraft.trim() || busy === r.routineId} onClick={() => void save(r.routineId)} style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 8, border: "1px solid oklch(0.85 0.02 262)", background: "white", color: "var(--ink)", cursor: "pointer" }}>
                            {busy === r.routineId ? "Saving…" : r.workflow ? "Replace" : "Use this workflow"}
                          </button>
                          <button type="button" disabled={!urlDraft.trim() || t === "running"} onClick={() => void test(r.routineId, urlDraft.trim())} style={{ fontSize: 12.5, padding: "7px 12px", borderRadius: 8, border: "1px solid oklch(0.85 0.02 262)", background: "white", color: "var(--ink)", cursor: "pointer" }}>
                            {t === "running" ? "Testing…" : "Test"}
                          </button>
                        </div>
                      )}
                      {t && t !== "running" && (
                        <div data-testid={`test-${r.routineId}`} style={{ marginTop: 8, padding: "9px 11px", borderRadius: 8, background: t.ok ? "oklch(0.96 0.03 150)" : "var(--amber-wash)", fontSize: 12.5, lineHeight: 1.5 }}>
                          {!t.ok && <>Didn’t work: {t.error} ({t.ms} ms)</>}
                          {t.ok && t.kind === "artifact" && (
                            <>
                              <div style={{ fontWeight: 600 }}>
                                Came back with a {t.artifact.kind}: {t.artifact.title} ({t.artifact.items} items · {t.ms} ms)
                              </div>
                              <div style={{ whiteSpace: "pre-wrap", marginTop: 4, color: "var(--muted-2)" }}>{t.artifact.body.slice(0, 600)}</div>
                            </>
                          )}
                          {t.ok && t.kind === "needs" && <>It asked for more: {t.needs.map((n) => n.platform ?? n.input ?? "?").join(", ")} ({t.ms} ms)</>}
                          {t.ok && t.kind === "accepted" && <>{t.note}</>}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}

        {data?.admin && data.accounts && (
          <div data-testid="skills-admin-spend" style={{ marginTop: 6, paddingTop: 14, borderTop: "1px solid oklch(0.9 0.01 90)" }}>
            <div style={{ fontSize: 11, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--muted)", fontWeight: 600, marginBottom: 8 }}>Model spend this month · every account (admin)</div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr auto auto", gap: "4px 16px", fontSize: 12.5 }}>
              {data.accounts.map((a) => (
                <div key={a.accountId} style={{ display: "contents" }}>
                  <span>{a.name}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{usd(a.spentUsd)}</span>
                  <span style={{ color: a.ok ? "var(--muted)" : "var(--amber-text)" }}>of {usd(a.capUsd)}</span>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 8, fontSize: 11.5, color: "var(--muted)" }}>Raise a cap with `accounts.monthly_llm_cap_usd` (service role); the default is UNC_ACCOUNT_MONTHLY_USD_CAP.</div>
          </div>
        )}
      </div>
    </div>
  );
}
