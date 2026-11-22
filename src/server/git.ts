import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export interface GitChangedFile {
  readonly status: string;
  readonly path: string;
}

export interface GitSnapshot {
  readonly canonicalPath: string;
  readonly branch: string;
  readonly headSha: string;
  readonly changedFiles: ReadonlyArray<GitChangedFile>;
  readonly recentCommits: ReadonlyArray<{ readonly sha: string; readonly subject: string }>;
}

function normalizeForCompare(target: string): string {
  const resolved = path.resolve(target);
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

export function assertAllowedGitRepository(
  rawPath: string,
  allowedRoots: ReadonlyArray<string>,
): string {
  if (!rawPath || typeof rawPath !== "string") {
    throw new Error("Path repository wajib diisi.");
  }
  let realPath: string;
  try {
    realPath = fs.realpathSync(rawPath.trim());
  } catch {
    throw new Error("Direktori repository tidak ditemukan di komputer host.");
  }

  const normalizedTarget = normalizeForCompare(realPath);
  const insideAllowed = allowedRoots.some((root) => {
    let realRoot: string;
    try {
      realRoot = fs.realpathSync(root);
    } catch {
      realRoot = path.resolve(root);
    }
    const normalizedRoot = normalizeForCompare(realRoot);
    if (normalizedTarget === normalizedRoot) return true;
    const prefix = normalizedRoot.endsWith(path.sep) ? normalizedRoot : `${normalizedRoot}${path.sep}`;
    return normalizedTarget.startsWith(prefix);
  });

  if (!insideAllowed) {
    throw new Error("Path berada di luar direktori kerja yang diizinkan server.");
  }

  const stat = fs.statSync(realPath);
  if (!stat.isDirectory()) {
    throw new Error("Target bukan direktori.");
  }

  try {
    const inside = execFileSync("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: realPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
    if (inside !== "true") {
      throw new Error("Bukan Git working tree.");
    }
  } catch {
    throw new Error("Direktori tersebut bukan repository Git yang valid.");
  }

  return realPath;
}

export function inspectGitRepository(canonicalPath: string): GitSnapshot {
  let branch = "HEAD";
  try {
    branch =
      execFileSync("git", ["branch", "--show-current"], {
        cwd: canonicalPath,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      }).trim() || "detached-HEAD";
  } catch {
    branch = "unknown";
  }

  let headSha = "belum-ada-commit";
  try {
    headSha = execFileSync("git", ["rev-parse", "--short=8", "HEAD"], {
      cwd: canonicalPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    }).trim();
  } catch {
    headSha = "empty";
  }

  const porcelain = execFileSync("git", ["status", "--porcelain=v1", "-uall"], {
    cwd: canonicalPath,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  const changedFiles: GitChangedFile[] = [];
  for (const line of porcelain.split(/\r?\n/)) {
    if (line.length < 4) continue;
    const status = line.slice(0, 2).trim() || "M";
    const filePath = line.slice(3).trim();
    if (filePath) {
      changedFiles.push({ status, path: filePath });
    }
  }

  const recentCommits: Array<{ sha: string; subject: string }> = [];
  try {
    const logOut = execFileSync("git", ["log", "-n", "5", "--pretty=format:%h\t%s"], {
      cwd: canonicalPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
    for (const row of logOut.split(/\r?\n/)) {
      if (!row.trim()) continue;
      const [sha = "", subject = ""] = row.split("\t");
      recentCommits.push({ sha, subject });
    }
  } catch {
    // Repository without commits yet.
  }

  return {
    canonicalPath,
    branch,
    headSha,
    changedFiles: changedFiles.slice(0, 120),
    recentCommits,
  };
}

export function readRepositoryDiff(canonicalPath: string, relativeFile?: string): string {
  const args = ["diff", "--no-ext-diff"];
  if (relativeFile && relativeFile.trim().length > 0) {
    const cleaned = relativeFile.trim().replace(/\\/g, "/");
    if (cleaned.startsWith("/") || cleaned.includes("..") || path.isAbsolute(cleaned)) {
      throw new Error("Nama file diff tidak valid.");
    }
    args.push("--", cleaned);
  }

  const trackedDiff = execFileSync("git", args, {
    cwd: canonicalPath,
    encoding: "utf8",
    maxBuffer: 512 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });

  if (trackedDiff.trim().length > 0) {
    return trackedDiff.slice(0, 60_000);
  }

  if (relativeFile && relativeFile.trim().length > 0) {
    const candidate = path.resolve(canonicalPath, relativeFile.trim());
    const normalizedRoot = normalizeForCompare(canonicalPath);
    const normalizedFile = normalizeForCompare(candidate);
    if (
      normalizedFile.startsWith(`${normalizedRoot}${path.sep}`) &&
      fs.existsSync(candidate) &&
      fs.statSync(candidate).isFile()
    ) {
      const preview = fs.readFileSync(candidate, "utf8").slice(0, 16_000);
      return `# File baru / belum terkomit: ${relativeFile}\n\n${preview}`;
    }
  }

  return "Tidak ada perubahan baris pada target ini.";
}
