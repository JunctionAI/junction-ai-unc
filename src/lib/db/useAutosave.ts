"use client";
/* Debounced autosave (800 ms, trailing). Saves only when the persisted projection of the
   state changed; never overlaps saves (a change during a save queues one more); flushes on
   pagehide as a best effort. Off entirely when `enabled` is false — demo mode costs nothing. */

import { useCallback, useEffect, useRef, useState } from "react";
import { createAutosaveQueue } from "./autosaveQueue";

export const AUTOSAVE_DELAY_MS = 800;

export type AutosaveStatus = "idle" | "pending" | "saving" | "saved" | "error";

export interface Autosave {
  status: AutosaveStatus;
  error: string | null;
  /** Save now (skips the debounce). */
  flush: () => Promise<void>;
}

export function useAutosave<T>(
  value: T,
  enabled: boolean,
  save: (value: T) => Promise<void>,
  projection: (value: T) => string,
  delayMs: number = AUTOSAVE_DELAY_MS,
): Autosave {
  const [status, setStatus] = useState<AutosaveStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(value);
  const lastSaved = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queue = useRef(createAutosaveQueue());
  const saveRef = useRef(save);
  const projRef = useRef(projection);
  // Refs track the latest props/value outside render (same pattern as useUncChat).
  useEffect(() => {
    saveRef.current = save;
    projRef.current = projection;
    latest.current = value;
  }, [save, projection, value]);

  /* One save loop at a time: if the value changes while a save is in flight, the loop
     goes round once more with the newest snapshot instead of starting a second save. */
  const run = useCallback((): Promise<void> => queue.current(async () => {
        const snapshot = latest.current;
        const proj = projRef.current(snapshot);
        if (proj === lastSaved.current) {
          setStatus((s) => (s === "pending" ? "saved" : s));
          return;
        }
        setStatus("saving");
        try {
          await saveRef.current(snapshot);
          lastSaved.current = proj;
          setError(null);
          setStatus("saved");
        } catch (e) {
          setError(e instanceof Error ? e.message : String(e));
          setStatus("error");
        }
  }), []);

  useEffect(() => {
    if (!enabled) return;
    const proj = projRef.current(value);
    if (proj === lastSaved.current) return;
    setStatus("pending");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void run();
    }, delayMs);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [value, enabled, delayMs, run]);

  useEffect(() => {
    if (!enabled) return;
    const onHide = () => {
      if (timer.current) {
        clearTimeout(timer.current);
        timer.current = null;
        void run();
      }
    };
    window.addEventListener("pagehide", onHide);
    document.addEventListener("visibilitychange", onHide);
    return () => {
      window.removeEventListener("pagehide", onHide);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [enabled, run]);

  /** Mark the current value as already persisted (after a load) so it isn't re-saved. */
  const flush = useCallback(async () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
    await run();
  }, [run]);

  return { status, error, flush };
}
