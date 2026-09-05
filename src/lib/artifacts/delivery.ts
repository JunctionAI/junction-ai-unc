import { deliverOutbound, type OutboundDeps } from "../channels/outbound";
import { messagingDisabled } from "../channels/releaseGate";
import type { Channel } from "../channels/types";
import { unwrap, type Row } from "../db/types";
import { assertRuntimeContext } from "../db/runtimeContext";
import { ArtifactError, type ArtifactView } from "./handlers";
import { markdownToPlain } from "./markdown";

export function artifactMessage(a: ArtifactView): string {
  return `${a.title}\n\n${markdownToPlain(a.editedBody ?? a.body)}${a.items.length ? `\n\n${a.items.map((it, i) => `${i + 1}. ${it.title}\n${markdownToPlain(it.body)}`).join("\n\n")}` : ""}`.slice(0, 3800);
}

export async function sendArtifact(deps: OutboundDeps, input: {
  accountId: string; contextGeneration: number; userId: string; artifact: ArtifactView;
  expectedRevision: number; channel: Channel;
}) {
  const identity = Object.freeze({ accountId: input.accountId, contextGeneration: input.contextGeneration });
  const request = Object.freeze({
    acct: identity.accountId, generation: identity.contextGeneration, actor: input.userId,
    artifact_id: input.artifact.id, expected_revision: input.expectedRevision,
    requested_channel: input.channel, message_text: artifactMessage(input.artifact),
  });
  if (messagingDisabled(process.env)) throw new ArtifactError("unavailable", "Messaging is disabled. Nothing was sent.");
  await assertRuntimeContext(deps.db, identity);
  const result = await deps.db.rpc("prepare_artifact_delivery", request);
  if (result.error) throw new ArtifactError(result.error.code === "P0002" ? "not_found" : "conflict", result.error.message);
  const prepared = result.data as { id: string; operations: Row[] };
  // Claim each original outbox ID, not a current link. SQL checks source revision,
  // ownership and original destination at claim; accepted receipts survive reset.
  for (const operation of prepared.operations) {
    if (operation.account_id !== identity.accountId || operation.context_generation !== identity.contextGeneration)
      throw new Error("Artifact delivery identity mismatch");
    if (operation.status === "queued") await deliverOutbound({ ...deps, guard: () => assertRuntimeContext(deps.db, identity) }, String(operation.id));
  }
  const rows = await unwrap<Row[]>("artifact.delivery.readback", deps.db.from("outbound_messages").select("id,channel,status")
    .eq("account_id", identity.accountId).eq("context_generation", identity.contextGeneration)
    .in("id", prepared.operations.map(o => o.id)));
  if (rows.length !== prepared.operations.length) throw new Error("Artifact delivery evidence missing");
  await assertRuntimeContext(deps.db, identity, { allowPaused: true });
  return { deliveryId: prepared.id, sent: rows.map(r => ({ ledgerId: String(r.id), channel: String(r.channel), status: String(r.status) })) };
}
