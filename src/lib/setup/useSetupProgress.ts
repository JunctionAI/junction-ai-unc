"use client";
/* Setup progress for Home's "Getting set up" card and the guided steps (GET /api/setup/progress).
   Enabled only in accounts mode; a no-op in demo mode, so the demo Home never fetches.
   `refresh()` after anything that moves a step (a connect return, a routine turned on, a
   decision, a brief written). */

import { useCallback, useEffect, useState } from "react";
import type { SetupProgress } from "./progress";

export interface SetupProgressState {
  /** true once the payload is in hand. */
  active: boolean;
  loading: boolean;
  data: SetupProgress | null;
  error: string | null;
  refresh: () => void;
}

export function useSetupProgress(enabled: boolean): SetupProgressState {
  const [data, setData] = useState<SetupProgress | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/setup/progress", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<SetupProgress> & { fallback?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || body.fallback || !Array.isArray(body.steps)) {
          setData(null);
          setError(body.error ?? (body.fallback ? null : `couldn’t load setup progress (${res.status})`));
        } else {
          setData(body as SetupProgress);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const refresh = useCallback(() => setTick((n) => n + 1), []);
  return { active: enabled && data !== null, loading: enabled && data === null && error === null, data, error, refresh };
}
