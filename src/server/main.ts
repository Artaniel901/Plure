import path from "node:path";

import { createPlureServer } from "./app.ts";

const args = process.argv.slice(2);
const allowLan = args.includes("--lan") || process.env.PLURE_HOST === "0.0.0.0";
const host = allowLan ? "0.0.0.0" : "127.0.0.1";
const port = Number(process.env.PLURE_PORT ?? "4310");
const dataDir = process.env.PLURE_DATA_DIR ?? path.resolve(process.cwd(), ".plure-data");
const allowedRoots = (process.env.PLURE_ALLOWED_ROOTS ?? `D:\\reverse-engineering`)
  .split(path.delimiter)
  .map((item) => item.trim())
  .filter(Boolean);

const handle = await createPlureServer({
  host,
  port,
  dataDir,
  allowedRoots,
  seedWorkspacePath: process.cwd(),
});

const localPairUrl = `http://127.0.0.1:${handle.port}/#pair=${encodeURIComponent(handle.bootstrapToken)}`;
console.log(`Plure Orchestration Studio listening on http://${host}:${handle.port}`);
console.log(`Local Pairing URL (open once in browser): ${localPairUrl}`);
if (allowLan && handle.networkAddresses.length > 0) {
  for (const origin of handle.networkAddresses) {
    console.log(`LAN / Phone Pairing URL: ${origin}/#pair=${encodeURIComponent(handle.bootstrapToken)}`);
  }
}

const shutdown = async () => {
  await handle.close();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown());
process.on("SIGTERM", () => void shutdown());
