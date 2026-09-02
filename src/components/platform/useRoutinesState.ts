"use client";
/* The Routines view's real state in accounts mode (GET /api/routines/state). A no-op in demo
   mode, so the demo rows never fetch and stay byte-identical. `initial` lets a server render
   (tests) start with a listing in hand. */

import { useCallback, useEffect, useState } from "react";
import type { RoutinesStateListing, RoutineStateView } from "@/lib/runtime/routinesState";

export type { RoutinesStateListing, RoutineStateView };

export interface RoutinesLive {
  /** true once a listing is in hand. */
  active: boolean;
  loading: boolean;
  data: RoutinesStateListing | null;
  error: string | null;
  refresh: () => void;
  /** Patch one routine in place (after a switch / a run) without waiting for the refetch. */
  patch: (routine: RoutineStateView) => void;
}

export function useRoutinesState(enabled: boolean, initial: RoutinesStateListing | null = null): RoutinesLive {
  const [data, setData] = useState<RoutinesStateListing | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(enabled && !initial);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/routines/state", { cache: "no-store" });
        const body = (await res.json().catch(() => ({}))) as Partial<RoutinesStateListing> & { fallback?: boolean; error?: string };
        if (cancelled) return;
        if (!res.ok || body.fallback || !Array.isArray(body.routines)) {
          setError(body.error ?? (body.fallback ? null : `couldn’t load routines (${res.status})`));
        } else {
          setData(body as RoutinesStateListing);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [enabled, tick]);

  const patch = useCallback((routine: RoutineStateView) => {
    setData((d) => (d ? { ...d, routines: d.routines.map((r) => (r.routineId === routine.routineId ? routine : r)) } : d));
  }, []);

  return { active: data !== null, loading, data, error, refresh: () => setTick((n) => n + 1), patch };
}

/** "2h ago" · "just now" · "3d ago" — for the last-run line. */
export function agoLabel(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!Number.isFinite(ms) || ms < 60_000) return "just now";
  const m = Math.floor(ms / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 48) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export function runStatusLabel(status: string): string {
  switch (status) {
    case "done":
      return "done";
    case "skipped":
      return "nothing to do";
    case "failed":
      return "failed closed";
    case "running":
      return "running";
    case "waiting_approval":
      return "waiting on you";
    default:
      return status;
  }
}
