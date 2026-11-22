import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distDir = path.join(root, "dist");
const distServer = path.join(distDir, "server");
const distPublic = path.join(distDir, "public");

fs.rmSync(distDir, { recursive: true, force: true });
fs.mkdirSync(distServer, { recursive: true });
fs.mkdirSync(distPublic, { recursive: true });

for (const entry of fs.readdirSync(path.join(root, "src", "server"))) {
  fs.copyFileSync(
    path.join(root, "src", "server", entry),
    path.join(distServer, entry),
  );
}

for (const entry of fs.readdirSync(path.join(root, "src", "web"))) {
  fs.copyFileSync(
    path.join(root, "src", "web", entry),
    path.join(distPublic, entry),
  );
}

console.log(`Built Plure runtime into ${distDir}`);
