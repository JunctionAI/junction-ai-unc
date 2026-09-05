"use client";
import { useCallback, useEffect, useState } from "react";
import { artifactHeaders } from "@/lib/artifacts/client";
import type { WorkspaceSnapshot } from "@/lib/workspace/read";

export function useWorkspace(accountId: string, contextGeneration: number, initial?: WorkspaceSnapshot) {
  const [data, setData] = useState<WorkspaceSnapshot | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!initial);
  const [tick, setTick] = useState(0);
  const refresh = useCallback(() => { setLoading(true); setTick(n => n + 1); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;
    const timeout = setTimeout(() => controller.abort(), 20_000);
    void (async () => {
      try {
        const response = await fetch("/api/workspace", { cache: "no-store", headers: artifactHeaders(accountId, contextGeneration), signal: controller.signal });
        const body = await response.json() as WorkspaceSnapshot;
        if (cancelled) return;
        if (!response.ok || body.accountId !== accountId || body.contextGeneration !== contextGeneration ||
          !Array.isArray(body.artifacts) || !Array.isArray(body.runs) || !Array.isArray(body.approvals) || !Array.isArray(body.receipts) || !Array.isArray(body.routines) || !body.counts || !body.truncated || typeof body.canReview !== "boolean" || typeof body.paused !== "boolean")
          throw new Error("Couldn’t verify this account’s workspace. Refresh to try again.");
        if (body.artifacts.some(a => a.accountId !== accountId || a.contextGeneration !== contextGeneration)) throw new Error("Workspace context changed. Reload your account.");
        setData(body); setError(null);
      } catch { if (!cancelled) { setData(null); setError("Couldn’t load current work. No empty or completed state has been assumed. Try refreshing."); } }
      finally { clearTimeout(timeout); if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; clearTimeout(timeout); controller.abort(); };
  }, [accountId, contextGeneration, tick]);
  useEffect(() => {
    const visible = () => { if (document.visibilityState === "visible") refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => document.removeEventListener("visibilitychange", visible);
  }, [refresh]);
  return { data, error, loading, refresh, setData };
}
