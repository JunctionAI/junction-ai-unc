"use client";

import { useCallback, useState } from "react";
import { initialState, type PlatformState, type Setter } from "@/lib/platform/state";

/** The prototype's `this.state` / `this.setState` pair as a single React hook.
    Client-side only for Phase 1 — persistence comes later. */
export function usePlatformState(): { S: PlatformState; set: Setter } {
  const [S, setS] = useState<PlatformState>(initialState);
  const set: Setter = useCallback((patch) => {
    setS((prev) => ({ ...prev, ...(typeof patch === "function" ? patch(prev) : patch) }));
  }, []);
  return { S, set };
}
