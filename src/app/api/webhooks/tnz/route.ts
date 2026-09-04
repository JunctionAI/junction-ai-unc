import { after } from "next/server";
import { inboundDeps, serviceDbOrNull } from "@/lib/channels/server";
import { drainInboundEvents, saveInboundEvents } from "@/lib/channels/inbox";
import { handleInbound } from "@/lib/channels/inbound";
import { receiveTnz } from "@/lib/channels/tnzReceiver";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  return receiveTnz(req, { env: process.env, now: new Date(), save: async events => {
    const db = serviceDbOrNull();
    if (!db) throw new Error("SMS storage unavailable");
    await saveInboundEvents(db, events);
  }, wake: () => after(async () => {
    const deps = inboundDeps();
    if (deps) await drainInboundEvents(deps.db, event => handleInbound(deps, event), 40_000);
  }) });
}
