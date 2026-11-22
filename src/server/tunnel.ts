import { spawn, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface TunnelLaunchResult {
  readonly publicUrl: string;
  readonly stop: () => Promise<void>;
}

export type TunnelLauncher = (localPort: number) => Promise<TunnelLaunchResult>;

export interface TunnelSnapshot {
  readonly status: "offline" | "starting" | "online" | "error";
  readonly publicUrl: string | null;
  readonly binaryFound: boolean;
  readonly error: string | null;
}

const KNOWN_CLOUDFLARED_PATHS = [
  "D:\\reverse-engineering\\.agentic\\integrations\\runtime\\cloudflared\\2026.10.7\\cloudflared.exe",
];

export function resolveCloudflaredBinary(): string | null {
  if (process.env.PLURE_CLOUDFLARED_PATH && fs.existsSync(process.env.PLURE_CLOUDFLARED_PATH)) {
    return process.env.PLURE_CLOUDFLARED_PATH;
  }
  for (const candidate of KNOWN_CLOUDFLARED_PATHS) {
    if (fs.existsSync(candidate)) return candidate;
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const names = process.platform === "win32" ? ["cloudflared.exe", "cloudflared.cmd"] : ["cloudflared"];
  for (const dir of dirs) {
    for (const name of names) {
      const full = path.join(dir, name);
      if (fs.existsSync(full)) return full;
    }
  }
  return null;
}

export const defaultCloudflaredLauncher: TunnelLauncher = async (localPort: number) => {
  const bin = resolveCloudflaredBinary();
  if (!bin) {
    throw new Error(
      "cloudflared binary not found. Install cloudflared or set PLURE_CLOUDFLARED_PATH.",
    );
  }

  return await new Promise<TunnelLaunchResult>((resolve, reject) => {
    const child: ChildProcess = spawn(
      bin,
      ["tunnel", "--url", `http://127.0.0.1:${localPort}`, "--no-autoupdate"],
      {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );

    let settled = false;
    let combinedLogs = "";

    const stop = async () => {
      if (child.killed || child.exitCode !== null) return;
      await new Promise<void>((done) => {
        child.once("exit", () => done());
        child.kill();
        setTimeout(() => done(), 2500);
      });
    };

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void stop();
      reject(new Error("Timed out waiting for Cloudflare Tunnel public HTTPS URL."));
    }, 25_000);

    const onChunk = (chunk: Buffer) => {
      if (settled) return;
      combinedLogs += chunk.toString("utf8");
      const match = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i.exec(combinedLogs);
      if (match?.[0]) {
        settled = true;
        clearTimeout(timer);
        resolve({ publicUrl: match[0], stop });
      }
    };

    child.stdout?.on("data", onChunk);
    child.stderr?.on("data", onChunk);

    child.once("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`Failed to launch cloudflared: ${err.message}`));
    });

    child.once("exit", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`cloudflared exited early with code ${code ?? -1}.`));
    });
  });
};
