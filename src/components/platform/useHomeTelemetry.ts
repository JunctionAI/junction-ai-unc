"use client";
/* Home's telemetry in accounts mode: Unc's latest self-review, the three "The bar" inputs
   and hours saved (GET /api/telemetry/home). A no-op in demo mode, so the demo Home never
   fetches and stays byte-identical. */

import { useEffect, useState } from "react";
import type { HomeTelemetry } from "@/lib/platform/telemetry";

export interface HomeTelemetryState {
  /** true once the payload is in hand — Home swaps its demo bar/hours/review only then. */
  active: boolean;
  data: HomeTelemetry | null;
  error: string | null;
  refresh: () => void;
}

export function useHomeTelemetry(enabled: boolean): HomeTelemetryState {
  const [data, setData] = useState<HomeTelemetry | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/telemetry/home", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<HomeTelemetry> & { fallback?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || body.fallback || !Array.isArray(body.bar) || !body.automation) {
          setData(null);
          setError(body.error ?? (body.fallback ? null : `couldn’t load telemetry (${res.status})`));
        } else {
          setData(body as HomeTelemetry);
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

  return { active: enabled && data !== null, data, error, refresh: () => setTick((n) => n + 1) };
}
