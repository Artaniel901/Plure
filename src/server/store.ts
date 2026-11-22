import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

import {
  DEFAULT_ROLE_ASSIGNMENTS,
  type AgentRole,
  type ProviderId,
} from "./providers.ts";

export interface RoleSelection {
  readonly providerId: ProviderId;
  readonly model: string;
}

export interface WorkspaceRecord {
  readonly id: string;
  readonly label: string;
  readonly rootPath: string;
  readonly createdAt: string;
}

export interface MissionStepRecord {
  readonly id: string;
  readonly missionId: string;
  readonly ordinal: number;
  readonly role: AgentRole;
  readonly title: string;
  readonly providerId: ProviderId;
  readonly model: string;
  readonly status: "queued" | "running" | "completed" | "simulated" | "failed";
  readonly detail: string;
  readonly updatedAt: string;
}

export interface MissionRecord {
  readonly id: string;
  readonly workspaceId: string;
  readonly objective: string;
  readonly executionMode: "plan" | "cli";
  readonly status: "running" | "completed" | "failed";
  readonly cooProviderId: ProviderId;
  readonly cooModel: string;
  readonly implementerProviderId: ProviderId;
  readonly implementerModel: string;
  readonly researcherProviderId: ProviderId;
  readonly researcherModel: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly steps: ReadonlyArray<MissionStepRecord>;
}

export class PlureStore {
  readonly #db: DatabaseSync;

  constructor(dataDir: string) {
    fs.mkdirSync(dataDir, { recursive: true });
    this.#db = new DatabaseSync(path.join(dataDir, "plure.sqlite"));
    this.#migrate();
  }

  #migrate(): void {
    this.#db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        device_label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS invites (
        code_hash TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at INTEGER NOT NULL,
        consumed INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS role_settings (
        role TEXT PRIMARY KEY,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        root_path TEXT NOT NULL UNIQUE,
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS missions (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        objective TEXT NOT NULL,
        execution_mode TEXT NOT NULL,
        status TEXT NOT NULL,
        coo_provider_id TEXT NOT NULL,
        coo_model TEXT NOT NULL,
        implementer_provider_id TEXT NOT NULL,
        implementer_model TEXT NOT NULL,
        researcher_provider_id TEXT NOT NULL,
        researcher_model TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS mission_steps (
        id TEXT PRIMARY KEY,
        mission_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        role TEXT NOT NULL,
        title TEXT NOT NULL,
        provider_id TEXT NOT NULL,
        model TEXT NOT NULL,
        status TEXT NOT NULL,
        detail TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        FOREIGN KEY (mission_id) REFERENCES missions(id) ON DELETE CASCADE
      );
    `);

    const now = new Date().toISOString();
    const upsertRole = this.#db.prepare(`
      INSERT INTO role_settings (role, provider_id, model, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(role) DO NOTHING
    `);
    for (const [role, cfg] of Object.entries(DEFAULT_ROLE_ASSIGNMENTS)) {
      upsertRole.run(role, cfg.providerId, cfg.model, now);
    }
  }

  static hashSecret(raw: string): string {
    return crypto.createHash("sha256").update(raw, "utf8").digest("hex");
  }

  createSession(deviceLabel: string, ttlMs = 30 * 24 * 60 * 60 * 1000): string {
    const rawToken = crypto.randomBytes(32).toString("base64url");
    const hash = PlureStore.hashSecret(rawToken);
    const now = new Date().toISOString();
    this.#db
      .prepare(
        "INSERT INTO sessions (token_hash, device_label, created_at, expires_at) VALUES (?, ?, ?, ?)",
      )
      .run(hash, deviceLabel.slice(0, 80) || "Perangkat Web", now, Date.now() + ttlMs);
    return rawToken;
  }

  verifySession(rawToken: string | undefined): boolean {
    if (!rawToken) return false;
    const hash = PlureStore.hashSecret(rawToken);
    const row = this.#db
      .prepare("SELECT expires_at FROM sessions WHERE token_hash = ?")
      .get(hash) as { expires_at: number } | undefined;
    if (!row) return false;
    if (row.expires_at < Date.now()) {
      this.#db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hash);
      return false;
    }
    return true;
  }

  createInvite(label: string, ttlMs = 15 * 60 * 1000): { code: string; expiresAt: string } {
    const code = crypto.randomBytes(12).toString("base64url");
    const hash = PlureStore.hashSecret(code);
    const expiresAtMs = Date.now() + ttlMs;
    this.#db
      .prepare(
        "INSERT INTO invites (code_hash, label, created_at, expires_at, consumed) VALUES (?, ?, ?, ?, 0)",
      )
      .run(hash, label.slice(0, 80) || "Perangkat HP", new Date().toISOString(), expiresAtMs);
    return { code, expiresAt: new Date(expiresAtMs).toISOString() };
  }

  consumeInvite(code: string): boolean {
    const hash = PlureStore.hashSecret(code);
    const row = this.#db
      .prepare("SELECT expires_at, consumed FROM invites WHERE code_hash = ?")
      .get(hash) as { expires_at: number; consumed: number } | undefined;
    if (!row || row.consumed !== 0 || row.expires_at < Date.now()) {
      return false;
    }
    const result = this.#db
      .prepare("UPDATE invites SET consumed = 1 WHERE code_hash = ? AND consumed = 0")
      .run(hash);
    return result.changes === 1;
  }

  getRoles(): Record<AgentRole, RoleSelection> {
    const rows = this.#db
      .prepare("SELECT role, provider_id, model FROM role_settings")
      .all() as Array<{ role: AgentRole; provider_id: ProviderId; model: string }>;
    const out: Record<AgentRole, RoleSelection> = { ...DEFAULT_ROLE_ASSIGNMENTS };
    for (const row of rows) {
      out[row.role] = { providerId: row.provider_id, model: row.model };
    }
    return out;
  }

  updateRole(role: AgentRole, providerId: ProviderId, model: string): Record<AgentRole, RoleSelection> {
    this.#db
      .prepare(
        `INSERT INTO role_settings (role, provider_id, model, updated_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(role) DO UPDATE SET provider_id = excluded.provider_id, model = excluded.model, updated_at = excluded.updated_at`,
      )
      .run(role, providerId, model.trim(), new Date().toISOString());
    return this.getRoles();
  }

  listWorkspaces(): ReadonlyArray<WorkspaceRecord> {
    const rows = this.#db
      .prepare("SELECT id, label, root_path, created_at FROM workspaces ORDER BY created_at DESC")
      .all() as Array<{ id: string; label: string; root_path: string; created_at: string }>;
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      rootPath: r.root_path,
      createdAt: r.created_at,
    }));
  }

  getWorkspace(id: string): WorkspaceRecord | null {
    const row = this.#db
      .prepare("SELECT id, label, root_path, created_at FROM workspaces WHERE id = ?")
      .get(id) as { id: string; label: string; root_path: string; created_at: string } | undefined;
    return row
      ? { id: row.id, label: row.label, rootPath: row.root_path, createdAt: row.created_at }
      : null;
  }

  addWorkspace(label: string, canonicalPath: string): WorkspaceRecord {
    const existing = this.#db
      .prepare("SELECT id, label, root_path, created_at FROM workspaces WHERE root_path = ?")
      .get(canonicalPath) as
      | { id: string; label: string; root_path: string; created_at: string }
      | undefined;
    if (existing) {
      return {
        id: existing.id,
        label: existing.label,
        rootPath: existing.root_path,
        createdAt: existing.created_at,
      };
    }
    const id = `ws_${crypto.randomUUID().slice(0, 8)}`;
    const createdAt = new Date().toISOString();
    this.#db
      .prepare("INSERT INTO workspaces (id, label, root_path, created_at) VALUES (?, ?, ?, ?)")
      .run(id, label, canonicalPath, createdAt);
    return { id, label, rootPath: canonicalPath, createdAt };
  }

  createMission(input: {
    workspaceId: string;
    objective: string;
    executionMode: "plan" | "cli";
    roles: Record<AgentRole, RoleSelection>;
    steps: ReadonlyArray<{
      role: AgentRole;
      title: string;
      providerId: ProviderId;
      model: string;
      status: MissionStepRecord["status"];
      detail: string;
    }>;
    status: MissionRecord["status"];
  }): MissionRecord {
    const id = `msn_${crypto.randomUUID().slice(0, 8)}`;
    const now = new Date().toISOString();
    this.#db
      .prepare(
        `INSERT INTO missions (
          id, workspace_id, objective, execution_mode, status,
          coo_provider_id, coo_model,
          implementer_provider_id, implementer_model,
          researcher_provider_id, researcher_model,
          created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        id,
        input.workspaceId,
        input.objective,
        input.executionMode,
        input.status,
        input.roles.coo.providerId,
        input.roles.coo.model,
        input.roles.implementer.providerId,
        input.roles.implementer.model,
        input.roles.researcher.providerId,
        input.roles.researcher.model,
        now,
        now,
      );

    const insertStep = this.#db.prepare(
      `INSERT INTO mission_steps (
        id, mission_id, ordinal, role, title, provider_id, model, status, detail, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    input.steps.forEach((step, idx) => {
      insertStep.run(
        `stp_${crypto.randomUUID().slice(0, 8)}`,
        id,
        idx + 1,
        step.role,
        step.title,
        step.providerId,
        step.model,
        step.status,
        step.detail,
        now,
      );
    });

    return this.getMission(id)!;
  }

  switchMissionModel(
    missionId: string,
    role: AgentRole,
    providerId: ProviderId,
    model: string,
  ): MissionRecord | null {
    const current = this.getMission(missionId);
    if (!current) return null;
    const now = new Date().toISOString();
    const columnPrefix =
      role === "coo"
        ? "coo"
        : role === "implementer"
          ? "implementer"
          : "researcher";

    this.#db
      .prepare(
        `UPDATE missions
         SET ${columnPrefix}_provider_id = ?, ${columnPrefix}_model = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(providerId, model, now, missionId);

    this.#db
      .prepare(
        `INSERT INTO mission_steps (
          id, mission_id, ordinal, role, title, provider_id, model, status, detail, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        `stp_${crypto.randomUUID().slice(0, 8)}`,
        missionId,
        current.steps.length + 1,
        role,
        `Pergantian model langsung (${role.toUpperCase()})`,
        providerId,
        model,
        "completed",
        `Model peran ${role.toUpperCase()} dialihkan secara langsung ke ${providerId} · ${model} untuk giliran berikutnya.`,
        now,
      );

    return this.getMission(missionId);
  }

  getMission(id: string): MissionRecord | null {
    const row = this.#db
      .prepare("SELECT * FROM missions WHERE id = ?")
      .get(id) as Record<string, string> | undefined;
    if (!row) return null;
    return this.#hydrateMission(row);
  }

  listMissions(workspaceId?: string): ReadonlyArray<MissionRecord> {
    const rows = (
      workspaceId
        ? this.#db
            .prepare("SELECT * FROM missions WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 20")
            .all(workspaceId)
        : this.#db.prepare("SELECT * FROM missions ORDER BY created_at DESC LIMIT 20").all()
    ) as Array<Record<string, string>>;
    return rows.map((row) => this.#hydrateMission(row));
  }

  #hydrateMission(row: Record<string, string>): MissionRecord {
    const steps = this.#db
      .prepare("SELECT * FROM mission_steps WHERE mission_id = ? ORDER BY ordinal ASC")
      .all(row.id!) as Array<Record<string, string | number>>;
    return {
      id: String(row.id),
      workspaceId: String(row.workspace_id),
      objective: String(row.objective),
      executionMode: row.execution_mode === "cli" ? "cli" : "plan",
      status: (row.status as MissionRecord["status"]) ?? "completed",
      cooProviderId: row.coo_provider_id as ProviderId,
      cooModel: String(row.coo_model),
      implementerProviderId: row.implementer_provider_id as ProviderId,
      implementerModel: String(row.implementer_model),
      researcherProviderId: row.researcher_provider_id as ProviderId,
      researcherModel: String(row.researcher_model),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      steps: steps.map((s) => ({
        id: String(s.id),
        missionId: String(s.mission_id),
        ordinal: Number(s.ordinal),
        role: s.role as AgentRole,
        title: String(s.title),
        providerId: s.provider_id as ProviderId,
        model: String(s.model),
        status: s.status as MissionStepRecord["status"],
        detail: String(s.detail),
        updatedAt: String(s.updated_at),
      })),
    };
  }

  close(): void {
    this.#db.close();
  }
}
