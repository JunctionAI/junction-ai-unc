import type { ShadowAdmission } from "../shadowAdmission";

/** Isolates receipt/transport tests from permit issuance. This is NOT admission proof:
 * shadowAdmission.test.ts and the real PostgreSQL canary test the actual boundary. */
export function syntheticAdmission(): ShadowAdmission {
  return { claim: async () => "synthetic-permit", authorize: async () => true, observe: async () => {}, finish: async () => {} };
}
