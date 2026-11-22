import crypto from "node:crypto";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertAllowedGitRepository,
  inspectGitRepository,
  readRepositoryDiff,
} from "./git.ts";
import {
  isKnownProvider,
  isKnownRole,
  probeProviders,
  runProviderTurn,
  type AgentRole,
} from "./providers.ts";
import { PlureStore } from "./store.ts";

export interface PlureServerOptions {
  readonly host?: string;
  readonly port?: number;
  readonly dataDir?: string;
  readonly allowedRoots?: ReadonlyArray<string>;
  readonly staticDir?: string;
  readonly seedWorkspacePath?: string;
}

export interface PlureServerHandle {
  readonly port: number;
  readonly host: string;
  readonly bootstrapToken: string;
  readonly networkAddresses: ReadonlyArray<string>;
  readonly close: () => Promise<void>;
}

const MIME_BY_EXT: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".ico": "image/x-icon",
};

function timingSafeMatch(left: string, right: string): boolean {
  const a = Buffer.from(left, "utf8");
  const b = Buffer.from(right, "utf8");
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

function parseCookies(header: string | undefined): Record<string, string> {
  if (!header) return {};
  const out: Record<string, string> = {};
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq <= 0) continue;
    const key = part.slice(0, eq).trim();
    const val = part.slice(eq + 1).trim();
    out[key] = decodeURIComponent(val);
  }
  return out;
}

async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    total += buf.length;
    if (total > 256 * 1024) {
      throw new Error("Request body exceeds the 256 KB limit.");
    }
    chunks.push(buf);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("JSON payload must be an object.");
  }
  return parsed as Record<string, unknown>;
}

function sendJson(res: ServerResponse, status: number, payload: unknown, extraHeaders: Record<string, string> = {}): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    ...extraHeaders,
  });
  res.end(body);
}

function listLanAddresses(port: number): ReadonlyArray<string> {
  const nets = os.networkInterfaces();
  const urls: string[] = [];
  for (const entries of Object.values(nets)) {
    for (const net of entries ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        urls.push(`http://${net.address}:${port}`);
      }
    }
  }
  return urls;
}

export async function createPlureServer(options: PlureServerOptions = {}): Promise<PlureServerHandle> {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const defaultWebDir = fs.existsSync(path.resolve(currentDir, "../public/index.html"))
    ? path.resolve(currentDir, "../public")
    : path.resolve(currentDir, "../web");
  const staticDir = options.staticDir ?? defaultWebDir;
  const host = options.host ?? "127.0.0.1";
  const dataDir = options.dataDir ?? path.resolve(process.cwd(), ".plure-data");
  const allowedRoots = options.allowedRoots ?? [process.cwd(), path.resolve(process.cwd(), "..")];
  const bootstrapToken = crypto.randomBytes(24).toString("base64url");

  const store = new PlureStore(dataDir);
  if (options.seedWorkspacePath) {
    try {
      const canonical = assertAllowedGitRepository(options.seedWorkspacePath, allowedRoots);
      store.addWorkspace(path.basename(canonical), canonical);
    } catch {
      // Seed is optional.
    }
  }

  const sseClients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of sseClients) {
      client.write(frame);
    }
  };

  let boundPort = options.port ?? 0;

  const buildHydratedWorkspaces = () => {
    return store.listWorkspaces().map((ws) => {
      try {
        const snap = inspectGitRepository(ws.rootPath);
        return {
          ...ws,
          branch: snap.branch,
          headSha: snap.headSha,
          changedFiles: snap.changedFiles,
          recentCommits: snap.recentCommits,
        };
      } catch {
        return {
          ...ws,
          branch: "tidak-terbaca",
          headSha: "-",
          changedFiles: [],
          recentCommits: [],
        };
      }
    });
  };

  const server = http.createServer(async (req, res) => {
    try {
      const method = req.method ?? "GET";
      const reqUrl = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
      const pathname = reqUrl.pathname;

      if (pathname.startsWith("/api/")) {
        if (method !== "GET" && method !== "HEAD") {
          if (req.headers["x-plure-request"] !== "1") {
            sendJson(res, 403, { error: "Missing required security header X-Plure-Request." });
            return;
          }
        }

        if (pathname === "/api/auth/status" && method === "GET") {
          const cookies = parseCookies(req.headers.cookie);
          const authenticated = store.verifySession(cookies.plure_session);
          sendJson(res, 200, { authenticated });
          return;
        }

        if (pathname === "/api/auth/pair" && method === "POST") {
          const body = await readJsonBody(req);
          const candidate = typeof body.token === "string" ? body.token.trim() : "";
          const label = typeof body.deviceLabel === "string" ? body.deviceLabel.trim() : "Browser";
          const matchedBootstrap = candidate.length > 0 && timingSafeMatch(candidate, bootstrapToken);
          const matchedInvite = !matchedBootstrap && candidate.length > 0 && store.consumeInvite(candidate);

          if (!matchedBootstrap && !matchedInvite) {
            sendJson(res, 401, { error: "Invalid or expired pairing code." });
            return;
          }

          const sessionToken = store.createSession(label);
          sendJson(
            res,
            200,
            { ok: true },
            {
              "Set-Cookie": `plure_session=${encodeURIComponent(sessionToken)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000`,
            },
          );
          return;
        }

        const cookies = parseCookies(req.headers.cookie);
        if (!store.verifySession(cookies.plure_session)) {
          sendJson(res, 401, { error: "Unauthenticated session. Pair this device first." });
          return;
        }

        if (pathname === "/api/events" && method === "GET") {
          res.writeHead(200, {
            "Content-Type": "text/event-stream; charset=utf-8",
            "Cache-Control": "no-cache, no-transform",
            Connection: "keep-alive",
            "X-Content-Type-Options": "nosniff",
          });
          res.write(`event: connected\ndata: ${JSON.stringify({ ts: new Date().toISOString() })}\n\n`);
          sseClients.add(res);
          req.on("close", () => sseClients.delete(res));
          return;
        }

        if (pathname === "/api/state" && method === "GET") {
          const providers = probeProviders();
          const workspaces = buildHydratedWorkspaces();
          const missions = store.listMissions();
          sendJson(res, 200, {
            roles: store.getRoles(),
            providers,
            workspaces,
            missions,
            networkAddresses: listLanAddresses(boundPort),
            allowedRoots,
          });
          return;
        }

        if (pathname === "/api/auth/invite" && method === "POST") {
          const body = await readJsonBody(req);
          const label = typeof body.label === "string" ? body.label.trim() : "Mobile Device";
          const invite = store.createInvite(label);
          sendJson(res, 201, {
            code: invite.code,
            expiresAt: invite.expiresAt,
            lanUrls: listLanAddresses(boundPort).map(
              (origin) => `${origin}/#pair=${encodeURIComponent(invite.code)}`,
            ),
          });
          return;
        }

        if (pathname === "/api/roles" && method === "PATCH") {
          const body = await readJsonBody(req);
          const role = typeof body.role === "string" ? body.role : "";
          const providerId = typeof body.providerId === "string" ? body.providerId : "";
          const model = typeof body.model === "string" ? body.model.trim() : "";
          if (!isKnownRole(role) || !isKnownProvider(providerId) || model.length === 0) {
            sendJson(res, 400, { error: "Invalid role, provider, or model selection." });
            return;
          }
          const roles = store.updateRole(role, providerId, model);
          broadcast("roles_updated", { roles });
          sendJson(res, 200, { roles });
          return;
        }

        if (pathname === "/api/workspaces" && method === "POST") {
          const body = await readJsonBody(req);
          const rawPath = typeof body.path === "string" ? body.path : "";
          try {
            const canonical = assertAllowedGitRepository(rawPath, allowedRoots);
            const label =
              typeof body.label === "string" && body.label.trim().length > 0
                ? body.label.trim().slice(0, 80)
                : path.basename(canonical);
            const saved = store.addWorkspace(label, canonical);
            const snap = inspectGitRepository(canonical);
            const workspace = {
              ...saved,
              branch: snap.branch,
              headSha: snap.headSha,
              changedFiles: snap.changedFiles,
              recentCommits: snap.recentCommits,
            };
            broadcast("workspace_added", { workspace });
            sendJson(res, 201, { workspace });
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : "Failed to register repository.",
            });
          }
          return;
        }

        const diffMatch = /^\/api\/workspaces\/([^/]+)\/diff$/.exec(pathname);
        if (diffMatch && method === "GET") {
          const ws = store.getWorkspace(decodeURIComponent(diffMatch[1]!));
          if (!ws) {
            sendJson(res, 404, { error: "Workspace not found." });
            return;
          }
          const fileParam = reqUrl.searchParams.get("file") ?? undefined;
          try {
            const diff = readRepositoryDiff(ws.rootPath, fileParam);
            sendJson(res, 200, { diff });
          } catch (err) {
            sendJson(res, 400, {
              error: err instanceof Error ? err.message : "Failed to read Git diff.",
            });
          }
          return;
        }

        if (pathname === "/api/missions" && method === "POST") {
          const body = await readJsonBody(req);
          const workspaceId = typeof body.workspaceId === "string" ? body.workspaceId : "";
          const objective = typeof body.objective === "string" ? body.objective.trim() : "";
          const executionMode = body.executionMode === "cli" ? "cli" : "plan";

          const ws = store.getWorkspace(workspaceId);
          if (!ws) {
            sendJson(res, 400, { error: "Select a Git repository first." });
            return;
          }
          if (objective.length === 0 || objective.length > 8000) {
            sendJson(res, 400, { error: "Coding objective is required (up to 8,000 characters)." });
            return;
          }

          const roles = store.getRoles();
          const snap = inspectGitRepository(ws.rootPath);
          const providers = probeProviders();
          const providerMap = new Map(providers.map((p) => [p.id, p]));

          let cooSummary = `[COO PLAN (${roles.coo.providerId}/${roles.coo.model})] Decomposing objective on branch "${snap.branch}" (${snap.changedFiles.length} modified files): 1) Architecture & boundary review by Researcher, 2) Scoped edits & unit tests by Implementer in an isolated worktree, 3) Final verification & diff review by COO.`;
          const researchDetail = `Mapping symbol dependencies and security boundaries in ${ws.label} (${snap.headSha}) for: "${objective}".`;
          const implDetail = `Preparing scoped code changes and focused tests in ${ws.label} using ${roles.implementer.model}.`;
          let stepStatus: "simulated" | "completed" = "simulated";

          if (executionMode === "cli") {
            const cooProv = providerMap.get(roles.coo.providerId)!;
            const resTurn = await runProviderTurn({
              provider: cooProv,
              model: roles.coo.model,
              prompt: `As the COO for repository ${ws.label}, outline a concise execution plan for: ${objective}`,
              cwd: ws.rootPath,
            });
            cooSummary = resTurn.output;
            stepStatus = resTurn.ok ? "completed" : "simulated";
          }

          const mission = store.createMission({
            workspaceId: ws.id,
            objective,
            executionMode,
            roles,
            status: "completed",
            steps: [
              {
                role: "coo",
                title: "COO Decomposition & Orchestration Route",
                providerId: roles.coo.providerId,
                model: roles.coo.model,
                status: stepStatus,
                detail: cooSummary,
              },
              {
                role: "researcher",
                title: "Delegated Research & Context Audit",
                providerId: roles.researcher.providerId,
                model: roles.researcher.model,
                status: "simulated",
                detail: researchDetail,
              },
              {
                role: "implementer",
                title: "Delegated Implementation & Tests",
                providerId: roles.implementer.providerId,
                model: roles.implementer.model,
                status: "simulated",
                detail: implDetail,
              },
              {
                role: "coo",
                title: "Verification Gate & Final Synthesis",
                providerId: roles.coo.providerId,
                model: roles.coo.model,
                status: stepStatus,
                detail:
                  "Awaiting operator review before applying destructive operations or pushing changes.",
              },
            ],
          });

          broadcast("mission_created", { mission });
          sendJson(res, 201, { mission });
          return;
        }

        const switchMatch = /^\/api\/missions\/([^/]+)\/model$/.exec(pathname);
        if (switchMatch && method === "PATCH") {
          const body = await readJsonBody(req);
          const role = typeof body.role === "string" ? body.role : "";
          const providerId = typeof body.providerId === "string" ? body.providerId : "";
          const model = typeof body.model === "string" ? body.model.trim() : "";
          if (!isKnownRole(role) || !isKnownProvider(providerId) || model.length === 0) {
            sendJson(res, 400, { error: "Parameter pergantian model tidak valid." });
            return;
          }
          store.updateRole(role as AgentRole, providerId, model);
          const mission = store.switchMissionModel(
            decodeURIComponent(switchMatch[1]!),
            role as AgentRole,
            providerId,
            model,
          );
          if (!mission) {
            sendJson(res, 404, { error: "Misi tidak ditemukan." });
            return;
          }
          broadcast("mission_updated", { mission });
          sendJson(res, 200, { mission });
          return;
        }

        sendJson(res, 404, { error: "Endpoint API tidak ditemukan." });
        return;
      }

      const relPath = pathname === "/" ? "index.html" : pathname.replace(/^\/+/, "");
      const safeFile = path.resolve(staticDir, relPath);
      const normalizedStatic = process.platform === "win32" ? staticDir.toLowerCase() : staticDir;
      const normalizedTarget = process.platform === "win32" ? safeFile.toLowerCase() : safeFile;

      if (
        !normalizedTarget.startsWith(normalizedStatic) ||
        !fs.existsSync(safeFile) ||
        !fs.statSync(safeFile).isFile()
      ) {
        sendJson(res, 404, { error: "Halaman tidak ditemukan." });
        return;
      }

      const ext = path.extname(safeFile).toLowerCase();
      const contentType = MIME_BY_EXT[ext] ?? "application/octet-stream";
      res.writeHead(200, {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
        "X-Content-Type-Options": "nosniff",
        "X-Frame-Options": "DENY",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'",
      });
      fs.createReadStream(safeFile).pipe(res);
    } catch (err) {
      sendJson(res, 500, {
        error: err instanceof Error ? err.message : "Kesalahan internal server.",
      });
    }
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => resolve());
  });

  const addr = server.address();
  boundPort = typeof addr === "object" && addr ? addr.port : (options.port ?? 4310);

  return {
    port: boundPort,
    host,
    bootstrapToken,
    networkAddresses: listLanAddresses(boundPort),
    close: async () => {
      for (const client of sseClients) {
        client.end();
      }
      sseClients.clear();
      await new Promise<void>((resolve) => server.close(() => resolve()));
      store.close();
    },
  };
}
