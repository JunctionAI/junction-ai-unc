"use client";

import { useCallback, useEffect, useState } from "react";
import { applyConnectReturn } from "@/lib/connectors/returnParams";
import { initialState, type PlatformState, type Setter } from "@/lib/platform/state";
import { mergeState } from "@/lib/platform/mergeState";

/** The prototype's `this.state` / `this.setState` pair as a single React hook.
    Client-side only for Phase 1 — persistence comes later. */
export function usePlatformState(): { S: PlatformState; set: Setter } {
  const [S, setS] = useState<PlatformState>(initialState);
  const set: Setter = useCallback((patch) => {
    setS((prev) => mergeState(prev, typeof patch === "function" ? patch(prev) : patch));
  }, []);
  // Returning from a platform's OAuth screen (/app?connected=… | ?connect_error=…): no-op otherwise.
  useEffect(() => applyConnectReturn(set), [set]);
  return { S, set };
}
