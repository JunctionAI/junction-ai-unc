/** Serialise saves, coalescing changes during a write into one subsequent pass.
 * Deferring the loop ensures even a synchronous/no-op pass clears the assigned flight.
 */
export function createAutosaveQueue() {
  let inFlight: Promise<void> | null = null;
  let dirty = false;
  return async (saveLatest: () => Promise<void>): Promise<void> => {
    if (inFlight) {
      dirty = true;
      return inFlight;
    }
    const loop = Promise.resolve().then(async () => {
      do {
        dirty = false;
        await saveLatest();
      } while (dirty);
    });
    inFlight = loop;
    try { await loop; }
    finally { if (inFlight === loop) inFlight = null; }
  };
}
