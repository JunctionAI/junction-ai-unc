/** Durable one-use admission, separate from registration and from provider credentials.
 * No permit is minted here: a scoped operator approval must already exist in storage. */
import { createHash } from "node:crypto";
import { unwrap, type DbClient } from "../db/types";
import type { N8nCallResult } from "../runtime/types";
import { isCalendarShadow, type ShadowContract } from "./shadowProtocols";
import type { ShadowCandidate } from "./shadowCandidate";

export interface ShadowAdmissionIdentity {
  accountId: string; contextGeneration: number; runId: string; registrationId: string;
  contract: ShadowContract;
}
export interface ShadowAdmission {
  claim(input: ShadowAdmissionIdentity & { receiverUrl: string; requestDigest: string; tokenDigest: string }): Promise<string>;
  authorize(input: ShadowAdmissionIdentity & { specHash: string; tokenDigest: string }): Promise<boolean>;
  observe(permitId: string, executionId: string, candidate: ShadowCandidate): Promise<void>;
  finish(permitId: string, outcome: "verified" | "refused" | "uncertain", executionId?: string, result?: N8nCallResult): Promise<void>;
}
export const shadowTokenDigest = (token: string) => createHash("sha256").update(token).digest("hex");

export class DbShadowAdmission implements ShadowAdmission {
  constructor(private readonly db: DbClient) {}
  async claim(input: Parameters<ShadowAdmission["claim"]>[0]): Promise<string> {
    if (isCalendarShadow(input.contract)) throw new Error("Keyword admission cannot authorize a calendar");
    // Store only fingerprints, never the bearer or raw provider response/request headers.
    const id = await unwrap<unknown>("shadow.claim", this.db.rpc("claim_keyword_shadow_dispatch", { input }));
    if (typeof id !== "string" || !id) throw new Error("No unused shadow permit; reconcile previous work before rerunning");
    return id;
  }
  async authorize(input: Parameters<ShadowAdmission["authorize"]>[0]): Promise<boolean> {
    if (isCalendarShadow(input.contract)) return false;
    return (await unwrap<unknown>("shadow.authorize", this.db.rpc("consume_keyword_shadow_authority", { input }))) === true;
  }
  async observe(permitId: string, executionId: string, candidate: ShadowCandidate): Promise<void> {
    const saved = await unwrap<unknown>("shadow.observe", this.db.rpc("checkpoint_keyword_shadow_result", {
      permit_id: permitId, observed_execution: executionId, reported_result: candidate,
    }));
    if (saved !== true) throw new Error("Shadow execution identity was not checkpointed; reconcile without rerunning");
  }
  async finish(permitId: string, outcome: "verified" | "refused" | "uncertain", executionId?: string, result?: N8nCallResult): Promise<void> {
    const saved = await unwrap<unknown>("shadow.finish", this.db.rpc("finish_keyword_shadow_dispatch", {
      permit_id: permitId, outcome, observed_execution: executionId ?? null, saved_result: result ?? null,
    }));
    if (saved !== true) throw new Error("Shadow outcome was not recorded; reconcile without another provider request");
  }
}
