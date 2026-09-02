import * as path from "node:path";
import { startStaticServer } from "../../scripts/parity/static-server";

/* Serves design-reference/ (the original prototypes + their support files) for the
   whole run. Env vars set here are inherited by the worker processes, so specs read
   process.env.PROTO_BASE. The port is chosen by the OS unless PROTO_PORT is set. */
export default async function globalSetup() {
  const root = path.resolve(__dirname, "../../design-reference");
  const wanted = process.env.PROTO_PORT ? Number(process.env.PROTO_PORT) : 0;
  const server = await startStaticServer(root, wanted);
  process.env.PROTO_BASE = server.origin;
  console.log(`[e2e] prototypes served from ${server.origin} (design-reference/)`);
  return async () => {
    await server.close();
  };
}
