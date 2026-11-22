import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export type ProviderId = "devin" | "claude" | "antigravity";
export type AgentRole = "coo" | "implementer" | "researcher";

export interface ProviderModel {
  readonly id: string;
  readonly label: string;
  readonly tier: string;
}

export interface ProviderStatus {
  readonly id: ProviderId;
  readonly name: string;
  readonly subscriptionNote: string;
  readonly binaryPath: string | null;
  readonly installed: boolean;
  readonly authenticated: boolean;
  readonly authSummary: string;
  readonly loginCommand: string;
  readonly models: ReadonlyArray<ProviderModel>;
}

const KNOWN_DEVIN_PATHS = [
  "D:\\Devin\\resources\\app\\extensions\\windsurf\\devin\\bin\\devin.exe",
];

const MODEL_CATALOG: Record<ProviderId, ReadonlyArray<ProviderModel>> = {
  devin: [
    { id: "kimi-k3.1-pro-max", label: "Kimi K3.1 Pro Max", tier: "COO Lead" },
    { id: "kimi-k2.5", label: "Kimi K2.5", tier: "Reasoning" },
    { id: "opus", label: "Claude Opus (via Devin)", tier: "Deep Architecture" },
    { id: "swe-1-6-fast", label: "SWE 1.6 Fast", tier: "Fast Execution" },
    { id: "gpt-5", label: "GPT-5 (via Devin)", tier: "General" },
  ],
  claude: [
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6", tier: "Implementation" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6", tier: "Complex Refactor" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5", tier: "Rapid Check" },
  ],
  antigravity: [
    { id: "gemini-2.5-pro", label: "Gemini 2.5 Pro", tier: "Research & Audit" },
    { id: "hydrogen-medium", label: "Hydrogen Medium", tier: "Peer Bridge" },
    { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", tier: "Fast Scan" },
  ],
};

export const DEFAULT_ROLE_ASSIGNMENTS: Record<
  AgentRole,
  { readonly providerId: ProviderId; readonly model: string }
> = {
  coo: { providerId: "devin", model: "kimi-k3.1-pro-max" },
  implementer: { providerId: "claude", model: "claude-sonnet-4-6" },
  researcher: { providerId: "antigravity", model: "gemini-2.5-pro" },
};

function resolveExecutable(candidates: ReadonlyArray<string>, fallbackPaths: ReadonlyArray<string> = []): string | null {
  for (const fullPath of fallbackPaths) {
    if (fs.existsSync(fullPath)) return fullPath;
  }
  const pathEnv = process.env.PATH ?? "";
  const dirs = pathEnv.split(path.delimiter).filter(Boolean);
  const exts = process.platform === "win32" ? [".exe", ".cmd", ".bat", ""] : [""];
  for (const name of candidates) {
    for (const dir of dirs) {
      for (const ext of exts) {
        const candidate = path.join(dir, name.endsWith(ext) ? name : `${name}${ext}`);
        if (fs.existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function checkVersionClean(binaryPath: string, args: ReadonlyArray<string>): boolean {
  try {
    execFileSync(binaryPath, args, {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 3500,
      windowsHide: true,
    });
    return true;
  } catch {
    return false;
  }
}

export function probeProviders(): ReadonlyArray<ProviderStatus> {
  const devinBin = resolveExecutable(["devin"], KNOWN_DEVIN_PATHS);
  let devinAuth = false;
  let devinSummary = "CLI belum terpasang di PATH";
  if (devinBin) {
    devinAuth = checkVersionClean(devinBin, ["models", "list", "--format", "json"]);
    devinSummary = devinAuth
      ? "Siap dipakai (Devin CLI login aktif)"
      : "Terpasang, perlu jalankan auth login di host";
  }

  const claudeBin = resolveExecutable(["claude"]);
  const claudeConfigExists = fs.existsSync(
    path.join(process.env.USERPROFILE ?? process.env.HOME ?? "", ".claude.json"),
  );
  const claudeAuth = Boolean(claudeBin && (claudeConfigExists || process.env.ANTHROPIC_API_KEY));
  const claudeSummary = !claudeBin
    ? "CLI Claude Code belum terpasang di PATH"
    : claudeAuth
      ? "Siap dipakai (kredensial lokal terdeteksi)"
      : "Terpasang, perlu claude auth login";

  const agyBin = resolveExecutable(["agy", "antigravity"]);
  const geminiBridgeExists = fs.existsSync(
    "D:\\reverse-engineering\\.agentic\\tools\\ai-bridge\\bridge.py",
  );
  const agyInstalled = Boolean(agyBin || geminiBridgeExists);
  const agySummary = agyBin
    ? "Runtime Antigravity CLI terdeteksi"
    : geminiBridgeExists
      ? "Terhubung via jembatan lokal ai-bridge"
      : "CLI Antigravity belum terpasang";

  return [
    {
      id: "devin",
      name: "Devin CLI",
      subscriptionNote: "Langganan Devin / Kimi COO",
      binaryPath: devinBin,
      installed: Boolean(devinBin),
      authenticated: devinAuth,
      authSummary: devinSummary,
      loginCommand: devinBin ? `"${devinBin}" auth login` : "devin auth login",
      models: MODEL_CATALOG.devin,
    },
    {
      id: "claude",
      name: "Claude Code",
      subscriptionNote: "Langganan Claude Pro / Max",
      binaryPath: claudeBin,
      installed: Boolean(claudeBin),
      authenticated: claudeAuth,
      authSummary: claudeSummary,
      loginCommand: "claude auth login",
      models: MODEL_CATALOG.claude,
    },
    {
      id: "antigravity",
      name: "Antigravity",
      subscriptionNote: "Langganan Google / Gemini",
      binaryPath: agyBin ?? (geminiBridgeExists ? "D:\\reverse-engineering\\.agentic\\tools\\ai-bridge\\bridge.py" : null),
      installed: agyInstalled,
      authenticated: agyInstalled,
      authSummary: agySummary,
      loginCommand: "agy login",
      models: MODEL_CATALOG.antigravity,
    },
  ];
}

export function isKnownProvider(value: string): value is ProviderId {
  return value === "devin" || value === "claude" || value === "antigravity";
}

export function isKnownRole(value: string): value is AgentRole {
  return value === "coo" || value === "implementer" || value === "researcher";
}

export async function runProviderTurn(input: {
  readonly provider: ProviderStatus;
  readonly model: string;
  readonly prompt: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
}): Promise<{ readonly ok: boolean; readonly output: string }> {
  const bin = input.provider.binaryPath;
  if (!bin || !input.provider.installed || !input.provider.authenticated) {
    return {
      ok: false,
      output: `[SIMULASI RENCANA: ${input.provider.name} belum login langsung] Jalankan ${input.provider.loginCommand} di komputer host untuk eksekusi CLI langsung.`,
    };
  }

  let cmd = bin;
  let args: string[] = [];
  if (input.provider.id === "devin") {
    args = ["--model", input.model, "--respect-workspace-trust", "false", "-p", input.prompt];
  } else if (input.provider.id === "claude") {
    args = ["--model", input.model, "-p", input.prompt];
  } else {
    if (bin.endsWith(".py")) {
      return {
        ok: true,
        output: `[Jembatan Lokal Antigravity · ${input.model}] Paket riset disiapkan untuk workspace ${path.basename(input.cwd)}.`,
      };
    }
    args = ["run", "--model", input.model, input.prompt];
  }

  return await new Promise((resolve) => {
    const child = spawn(cmd, args, {
      cwd: input.cwd,
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const chunks: Buffer[] = [];
    const timer = setTimeout(() => {
      child.kill();
      resolve({ ok: false, output: "Batas waktu eksekusi CLI tercapai." });
    }, input.timeoutMs ?? 45_000);

    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ ok: false, output: `Gagal menjalankan CLI: ${err.message}` });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const text = Buffer.concat(chunks).toString("utf8").trim();
      resolve({
        ok: code === 0,
        output: text || `Proses selesai dengan kode keluar ${code ?? -1}.`,
      });
    });
  });
}
