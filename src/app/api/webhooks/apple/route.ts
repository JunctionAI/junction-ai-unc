/** Reserved endpoint only. Never accept events until the provider auth and payload contract
 * has been verified. A flag alone must not expose an unauthenticated webhook. */
export const runtime = "nodejs";
export function POST() {
  return Response.json({ error: "apple_channel_not_ready" }, { status: 503 });
}
