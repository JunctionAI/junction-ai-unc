import { unwrap, type DbClient, type Row } from "../lib/db/types";
import { DbCommandQueue } from "../lib/commands/queue";
import { commandOwner } from "../lib/commands/deps";
import { getLink } from "../lib/channels/links";
import { sendOnLink, type AdapterRegistry } from "../lib/channels/outbound";
import { assertRuntimeContext } from "../lib/db/runtimeContext";
import { messagingDisabled } from "../lib/channels/releaseGate";

export const seoPackageMessage = (market: string, count: number, accountId: string) =>
  `your ${market} SEO drafts are ready 🔎 i've prepared ${count} items from your keyword research and website. nothing is published. review the guide and page changes in Agents → SEO → Find searches you can win: https://junction-unc.vercel.app/app?account=${accountId}`;

/** Only the original successful keyword command may supply a destination.
 * The outbox's SQL guard rechecks the saved package and captured binding at claim. */
export async function notifySeoPackages(db: DbClient, adapters: AdapterRegistry, now = () => new Date()) {
  if (messagingDisabled(process.env) || process.env.UNC_SEO_PACKAGES_ENABLED !== "true") return;
  const jobs = await unwrap<Row[]>("seo.notify_ready", db.from("seo_work_packages").select("*").eq("status", "ready")
    .gte("finished_at", new Date(now().getTime() - 86_400_000).toISOString()).limit(20));
  for (const job of jobs) {
    const identity = { accountId: String(job.account_id), contextGeneration: Number(job.context_generation) };
    const source = await unwrap<Row|null>("seo.notify_source", db.from("artifacts").select("run_id").eq("account_id", identity.accountId).eq("id", job.keyword_artifact_id).maybeSingle());
    if (!source?.run_id) continue;
    const command = await new DbCommandQueue(db).get(identity.accountId, String(source.run_id));
    if (!command || command.status !== "done" || command.contextGeneration !== identity.contextGeneration ||
        command.actor.userId !== job.actor_id || command.actor.channel !== "slack" || !command.actor.linkId ||
        !command.actor.channelBinding?.threadId || !command.actor.channelBinding.conversationId || !await commandOwner(db, command.actor)) continue;
    const link = await getLink(db, command.actor.linkId);
    if (!link || link.bindingVersion !== command.actor.channelBinding.bindingVersion || link.userId !== job.actor_id) continue;
    const result = job.result as {artifact?: {items?: unknown[]}};
    const count = result.artifact?.items?.length;
    if (!count) continue;
    const guard = () => assertRuntimeContext(db, identity);
    await sendOnLink({db, adapters, now, guard}, link, "draft_landed", {text: seoPackageMessage(String(job.market), count, identity.accountId)}, {
      contextGeneration: identity.contextGeneration, ref: `seo-package:${job.id}`,
      replyContext: {live: false, inReplyTo: command.actor.requestId, conversationId: command.actor.channelBinding.conversationId, threadId: command.actor.channelBinding.threadId},
    });
  }
}
