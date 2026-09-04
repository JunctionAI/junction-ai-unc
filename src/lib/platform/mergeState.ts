/** Preserve identity for no-op patches so synchronization effects settle instead of
 * rerendering forever and starving debounced persistence. */
export function mergeState<T extends object>(previous: T, patch: Partial<T>): T {
  const keys = Object.keys(patch) as (keyof T)[];
  return keys.some(key => !Object.is(previous[key], patch[key]))
    ? { ...previous, ...patch }
    : previous;
}
