"use client";
/* The Connectors grid's real state in accounts mode (GET /api/connectors/state), with a short
   poll while a first read is in flight ("Reading…" → "Read ✓ · N metrics"). A no-op without
   a database; a 401 / fallback answer leaves the demo cards untouched. */

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConnectorsStateListing, ConnectorStateView } from "@/lib/connectors/state";

export type { ConnectorsStateListing, ConnectorStateView };

export const READ_POLL_MS = 3_000;
export const READ_POLL_MAX_MS = 120_000;

export interface ConnectorsLive {
  active: boolean;
  data: ConnectorsStateListing | null;
  error: string | null;
  refresh: () => void;
  /** Poll until the platform's first read has a result (or the cap passes). */
  watch: (platform: string) => void;
}

/** A connected row that has never been read yet — the first read is (or should be) running. */
export function isReading(c: ConnectorStateView): boolean {
  return c.status === "connected" && c.lastSyncResult === null;
}

export function useConnectorsState(enabled: boolean, initial: ConnectorsStateListing | null = null): ConnectorsLive {
  const [data, setData] = useState<ConnectorsStateListing | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const watching = useRef<{ platform: string; since: number } | null>(null);

  const load = useCallback(async (): Promise<ConnectorsStateListing | null> => {
    const res = await fetch("/api/connectors/state", { cache: "no-store" });
    const body = (await res.json().catch(() => ({}))) as Partial<ConnectorsStateListing> & { fallback?: boolean; error?: string };
    if (!res.ok || body.fallback || !Array.isArray(body.connectors)) {
      if (res.status !== 401 && !body.fallback) throw new Error(body.error ?? `couldn’t load connectors (${res.status})`);
      return null;
    }
    return body as ConnectorsStateListing;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const step = async () => {
      try {
        const d = await load();
        if (cancelled) return;
        if (d) setData(d);
        setError(null);
        const w = watching.current;
        const stillReading = d && w && d.connectors.some((c) => c.platform === w.platform && isReading(c));
        if (w && (!stillReading || Date.now() - w.since > READ_POLL_MAX_MS)) watching.current = null;
        if (watching.current) timer = setTimeout(() => void step(), READ_POLL_MS);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    };
    void step();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [enabled, tick, load]);

  return {
    active: data !== null,
    data,
    error,
    refresh: () => setTick((n) => n + 1),
    watch: (platform) => {
      watching.current = { platform, since: Date.now() };
      setTick((n) => n + 1);
    },
  };
}
