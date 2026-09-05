/** A context reset invalidates work; never rebase old work onto a new business. */
export interface RuntimeContextIdentity { accountId: string; contextGeneration?: number }

export class RuntimeContextError extends Error {
  constructor(public readonly code: "context_changed" | "automation_paused" | "context_unavailable", message: string) {
    super(message);
    this.name = "RuntimeContextError";
  }
}

export function runtimeGeneration(value: unknown): number {
  // Only the original generation supports pre-generation snapshots/demo fixtures.
  const generation = value === undefined ? 0 : value;
  if (!Number.isSafeInteger(generation) || (generation as number) < 0)
    throw new RuntimeContextError("context_unavailable", "The run's captured business context is invalid.");
  return generation as number;
}

export function assertSameRuntimeContext(expected: RuntimeContextIdentity, actual: RuntimeContextIdentity): void {
  if (!expected.accountId || actual.accountId !== expected.accountId ||
      runtimeGeneration(actual.contextGeneration) !== runtimeGeneration(expected.contextGeneration))
    throw new RuntimeContextError("context_changed", "The business context changed. This old run cannot be resumed or accepted.");
}
