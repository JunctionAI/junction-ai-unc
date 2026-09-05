"use client";
import { useAccountRequest } from "@/components/platform/AccountScope";
/* "Models" — which brain for which job. DB mode only (the sidebar hides the link in demo
   mode). Reads/writes /api/settings/models; the catalogue, tiers and approximate prices
   come from src/lib/llm/registry.ts through that route so the UI never guesses. */

import { useEffect, useState } from "react";
import { formatCost } from "@/lib/llm/registry";
import { LLM_TASKS, TASK_LABELS, type CatalogueEntry, type LlmTask, type ProviderId } from "@/lib/llm/types";

interface Resolved {
  id: string;
  provider: ProviderId;
  model: string;
  tier: string;
  source: "account" | "env" | "default" | "fallback";
  fallbackFrom: string | null;
}

interface Payload {
  prefs: Partial<Record<LlmTask, string>>;
  resolved: Record<LlmTask, Resolved | null>;
  catalogue: CatalogueEntry[];
  configured: Record<ProviderId, boolean>;
}

const PROVIDER_LABEL: Record<ProviderId, string> = { anthropic: "Anthropic", openai: "OpenAI", gemini: "Google", openrouter: "OpenRouter", custom: "Self-hosted" };
const TIER_LABEL: Record<string, string> = { fast: "fast · cheapest", balanced: "balanced", best: "best · dearest" };

const DEFAULT = "__default__";

export default function ModelSettings({ onClose }: { onClose: () => void }) {
  const accountRequest = useAccountRequest();
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<LlmTask | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await accountRequest("/api/settings/models", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<Payload> & { fallback?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || body.fallback || !Array.isArray(body.catalogue)) setError(body.error ?? "I couldn’t load the model settings just now.");
        else setData(body as Payload);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountRequest]);

  async function choose(task: LlmTask, value: string) {
    if (!data) return;
    setSaving(task);
    setError(null);
    try {
      const res = await accountRequest("/api/settings/models", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ task, modelId: value === DEFAULT ? null : value }) });
      const body = (await res.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!res.ok || !body.prefs) throw new Error(body.error ?? `couldn’t save (${res.status})`);
      setData({ ...data, prefs: body.prefs, resolved: body.resolved ?? data.resolved });
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(null);
    }
  }

  const grouped = (data?.catalogue ?? []).reduce<Record<string, CatalogueEntry[]>>((acc, e) => ((acc[e.provider] ??= []).push(e), acc), {});

  return (
    <div role="dialog" aria-label="Models" onClick={onClose} style={{ position: "fixed", inset: 0, background: "oklch(0.2 0.03 262 / 0.55)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 60 }}>
      <div onClick={(e) => e.stopPropagation()} style={{ width: "min(640px, 92vw)", maxHeight: "86vh", overflow: "auto", background: "var(--cream)", color: "var(--ink)", borderRadius: 14, padding: "26px 28px 22px", boxShadow: "0 24px 60px oklch(0.2 0.03 262 / 0.35)" }}>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--muted)" }}>Models</div>
            <h2 style={{ margin: "4px 0 0", fontSize: 20, fontWeight: 700 }}>Which brain for which job</h2>
          </div>
          <button type="button" onClick={onClose} style={{ border: "none", background: "transparent", cursor: "pointer", fontSize: 13, color: "var(--muted)" }}>
            Close
          </button>
        </div>
        <p style={{ margin: "10px 0 18px", fontSize: 13.5, lineHeight: 1.55, color: "var(--muted)" }}>
          I default to the best value for each — a fast model where the job is mechanical, a stronger one where the words matter. Change any of them and I’ll use it from the next run. Prices are approximate list prices per million tokens, not a bill.
        </p>

        {error && (
          <div style={{ marginBottom: 14, padding: "10px 12px", borderRadius: 9, background: "oklch(0.97 0.03 80)", color: "var(--ink)", fontSize: 13 }}>{error}</div>
        )}

        {!data && !error && <div style={{ fontSize: 13, color: "var(--muted)" }}>Fetching…</div>}

        {data && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {LLM_TASKS.map((task) => {
              const pref = data.prefs[task];
              const r = data.resolved[task];
              const entry = r ? data.catalogue.find((e) => e.id === r.id) : null;
              const line = r
                ? `${r.source === "account" ? "Your pick" : r.source === "env" ? "Set by the operator" : r.source === "fallback" ? `Standing in for ${r.fallbackFrom ?? "your pick"} (not connected)` : "My default"} · ${TIER_LABEL[r.tier] ?? r.tier}${entry ? ` · ${formatCost(entry)}` : ""}`
                : "No model provider is connected — I’ll use my written fallbacks.";
              return (
                <label key={task} style={{ display: "grid", gridTemplateColumns: "1fr 250px", gap: 14, alignItems: "center", padding: "12px 14px", borderRadius: 11, background: "oklch(0.985 0.01 90)", border: "1px solid oklch(0.92 0.01 90)" }}>
                  <div>
                    <div style={{ fontSize: 14, fontWeight: 600 }}>{TASK_LABELS[task]}</div>
                    <div style={{ marginTop: 3, fontSize: 12, color: "var(--muted)", lineHeight: 1.5 }}>{line}</div>
                  </div>
                  <select
                    value={pref ?? DEFAULT}
                    disabled={saving === task}
                    onChange={(e) => void choose(task, e.target.value)}
                    style={{ fontSize: 13, padding: "8px 10px", borderRadius: 8, border: "1px solid oklch(0.85 0.02 262)", background: "white", color: "var(--ink)" }}
                  >
                    <option value={DEFAULT}>My default{r && r.source !== "account" ? ` (${r.id})` : ""}</option>
                    {Object.entries(grouped).map(([provider, entries]) => (
                      <optgroup key={provider} label={`${PROVIDER_LABEL[provider as ProviderId]}${data.configured[provider as ProviderId] ? "" : " — not connected"}`}>
                        {entries.map((e) => (
                          <option key={e.id} value={e.id} disabled={!data.configured[e.provider]}>
                            {e.label} · {TIER_LABEL[e.tier] ?? e.tier} · {formatCost(e)}
                          </option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                </label>
              );
            })}
            <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--muted)", lineHeight: 1.5 }}>
              A provider shows as “not connected” until its key is set on the server (ANTHROPIC_API_KEY, OPENAI_API_KEY, GEMINI_API_KEY, OPENROUTER_API_KEY or LLM_CUSTOM_BASE_URL — see docs/MODELS.md). If a pick’s provider is missing I stand in with the same tier from a connected one.
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
