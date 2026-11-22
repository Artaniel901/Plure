import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, before, describe, it } from "node:test";

import { createPlureServer, type PlureServerHandle } from "../src/server/app.ts";
import { resolveTunnelSpawnSpec } from "../src/server/tunnel.ts";

describe("Plure clean-room orchestration server", () => {
  let tmpRoot = "";
  let repoDir = "";
  let dataDir = "";
  let handle: PlureServerHandle;
  let baseUrl = "";
  let sessionCookie = "";

  before(async () => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "plure-test-"));
    repoDir = path.join(tmpRoot, "sample-repo");
    dataDir = path.join(tmpRoot, "data");
    fs.mkdirSync(repoDir, { recursive: true });

    execFileSync("git", ["init", "-b", "main"], { cwd: repoDir });
    fs.writeFileSync(path.join(repoDir, "app.ts"), "export const sum = (a: number, b: number) => a + b;\n");
    execFileSync("git", ["add", "app.ts"], { cwd: repoDir });
    execFileSync(
      "git",
      ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
      { cwd: repoDir },
    );
    fs.writeFileSync(
      path.join(repoDir, "app.ts"),
      "export const sum = (a: number, b: number) => a + b;\nexport const mul = (a: number, b: number) => a * b;\n",
    );

    handle = await createPlureServer({
      host: "127.0.0.1",
      port: 0,
      dataDir,
      allowedRoots: [tmpRoot],
      tunnelLauncher: async () => ({
        publicUrl: "https://demo-plure.trycloudflare.com",
        stop: async () => undefined,
      }),
    });
    baseUrl = `http://127.0.0.1:${handle.port}`;
  });

  after(async () => {
    await handle?.close();
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it("blocks unauthenticated API access with 401", async () => {
    const res = await fetch(`${baseUrl}/api/state`);
    assert.equal(res.status, 401);
  });

  it("enforces X-Plure-Request CSRF header on mutations", async () => {
    const res = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: handle.bootstrapToken }),
    });
    assert.equal(res.status, 403);
  });

  it("rejects invalid pairing tokens and issues an HttpOnly session cookie for valid token", async () => {
    const bad = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ token: "wrong-token-value" }),
    });
    assert.equal(bad.status, 401);

    const good = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ token: handle.bootstrapToken, deviceLabel: "Test Phone" }),
    });
    assert.equal(good.status, 200);
    const setCookie = good.headers.get("set-cookie") ?? "";
    assert.match(setCookie, /plure_session=/);
    assert.match(setCookie, /HttpOnly/i);
    sessionCookie = setCookie.split(";")[0] ?? "";
  });

  it("defaults COO to Devin Kimi K3.1 Pro Max and supports live role model switching", async () => {
    const stateRes = await fetch(`${baseUrl}/api/state`, {
      headers: { Cookie: sessionCookie },
    });
    assert.equal(stateRes.status, 200);
    const state = (await stateRes.json()) as {
      roles: Record<string, { providerId: string; model: string }>;
    };

    assert.equal(state.roles.coo.providerId, "devin");
    assert.equal(state.roles.coo.model, "kimi-k3.1-pro-max");
    assert.equal(state.roles.implementer.providerId, "claude");
    assert.equal(state.roles.researcher.providerId, "antigravity");

    const switchRes = await fetch(`${baseUrl}/api/roles`, {
      method: "PATCH",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({
        role: "implementer",
        providerId: "claude",
        model: "claude-opus-4-6",
      }),
    });
    assert.equal(switchRes.status, 200);
    const updated = (await switchRes.json()) as {
      roles: Record<string, { providerId: string; model: string }>;
    };
    assert.equal(updated.roles.implementer.model, "claude-opus-4-6");
  });

  it("validates repository boundaries and reads real git status and file diffs", async () => {
    const outsideRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ path: path.parse(tmpRoot).root, label: "RootForbidden" }),
    });
    assert.equal(outsideRes.status, 400);

    const addRes = await fetch(`${baseUrl}/api/workspaces`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ path: repoDir, label: "Sample Repo" }),
    });
    assert.equal(addRes.status, 201);
    const added = (await addRes.json()) as {
      workspace: { id: string; branch: string; changedFiles: Array<{ path: string; status: string }> };
    };
    assert.equal(added.workspace.branch, "main");
    assert.equal(added.workspace.changedFiles.length, 1);
    assert.equal(added.workspace.changedFiles[0]?.path, "app.ts");

    const diffRes = await fetch(
      `${baseUrl}/api/workspaces/${added.workspace.id}/diff?file=${encodeURIComponent("app.ts")}`,
      { headers: { Cookie: sessionCookie } },
    );
    assert.equal(diffRes.status, 200);
    const diffPayload = (await diffRes.json()) as { diff: string };
    assert.match(diffPayload.diff, /\+export const mul/);
  });

  it("runs a COO mission with worker delegation packets and supports mid-mission model switching", async () => {
    const stateRes = await fetch(`${baseUrl}/api/state`, { headers: { Cookie: sessionCookie } });
    const state = (await stateRes.json()) as { workspaces: Array<{ id: string }> };
    const workspaceId = state.workspaces[0]!.id;

    const missionRes = await fetch(`${baseUrl}/api/missions`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({
        workspaceId,
        objective: "Tambahkan unit test untuk fungsi mul di app.ts dan audit edge case",
        executionMode: "plan",
      }),
    });
    assert.equal(missionRes.status, 201);
    const created = (await missionRes.json()) as {
      mission: {
        id: string;
        cooModel: string;
        steps: Array<{ role: string; providerId: string; model: string; status: string }>;
      };
    };
    assert.equal(created.mission.cooModel, "kimi-k3.1-pro-max");
    assert.equal(created.mission.steps.length, 4);
    assert.deepEqual(
      created.mission.steps.map((s) => s.role),
      ["coo", "researcher", "implementer", "coo"],
    );

    const switchMidRes = await fetch(`${baseUrl}/api/missions/${created.mission.id}/model`, {
      method: "PATCH",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({
        role: "coo",
        providerId: "claude",
        model: "claude-opus-4-6",
      }),
    });
    assert.equal(switchMidRes.status, 200);
    const switched = (await switchMidRes.json()) as {
      mission: { cooProviderId: string; cooModel: string };
    };
    assert.equal(switched.mission.cooProviderId, "claude");
    assert.equal(switched.mission.cooModel, "claude-opus-4-6");
  });

  it("mints one-time mobile pairing codes that work once and cannot be reused", async () => {
    const inviteRes = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ label: "HP Android" }),
    });
    assert.equal(inviteRes.status, 201);
    const invite = (await inviteRes.json()) as { code: string };
    assert.ok(invite.code.length >= 12);

    const firstUse = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ token: invite.code, deviceLabel: "HP Android" }),
    });
    assert.equal(firstUse.status, 200);

    const replayUse = await fetch(`${baseUrl}/api/auth/pair`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ token: invite.code, deviceLabel: "Replay Attacker" }),
    });
    assert.equal(replayUse.status, 401);
  });

  it("manages Cloudflare Tunnel start/stop and includes HTTPS tunnel URL in mobile invites", async () => {
    const startRes = await fetch(`${baseUrl}/api/tunnel/start`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({}),
    });
    assert.equal(startRes.status, 200);
    const started = (await startRes.json()) as {
      tunnel: { status: string; publicUrl: string | null };
    };
    assert.equal(started.tunnel.status, "online");
    assert.equal(started.tunnel.publicUrl, "https://demo-plure.trycloudflare.com");

    const inviteRes = await fetch(`${baseUrl}/api/auth/invite`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({ label: "iPhone Safari" }),
    });
    const invite = (await inviteRes.json()) as { publicPairUrl: string | null };
    assert.match(invite.publicPairUrl ?? "", /^https:\/\/demo-plure\.trycloudflare\.com\/#pair=/);

    const stopRes = await fetch(`${baseUrl}/api/tunnel/stop`, {
      method: "POST",
      headers: {
        Cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Plure-Request": "1",
      },
      body: JSON.stringify({}),
    });
    assert.equal(stopRes.status, 200);
    const stopped = (await stopRes.json()) as {
      tunnel: { status: string; publicUrl: string | null };
    };
    assert.equal(stopped.tunnel.status, "offline");
    assert.equal(stopped.tunnel.publicUrl, null);
  });

  it("rate-limits repeated failed pairing attempts with 429", async () => {
    let lastStatus = 0;
    for (let i = 0; i < 8; i += 1) {
      const res = await fetch(`${baseUrl}/api/auth/pair`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Plure-Request": "1",
          "CF-Connecting-IP": "203.0.113.77",
        },
        body: JSON.stringify({ token: `bad-${i}` }),
      });
      lastStatus = res.status;
    }
    assert.equal(lastStatus, 429);
  });

  it("prefers Named Cloudflare Tunnel (token or config) over temporary Quick Tunnel", () => {
    const tokenSpec = resolveTunnelSpawnSpec(4310, {
      PLURE_CF_TUNNEL_TOKEN: "eyJ_sample_token",
      PLURE_CF_PUBLIC_URL: "https://plure.example.com/",
    });
    assert.equal(tokenSpec.mode, "named-token");
    assert.equal(tokenSpec.configuredPublicUrl, "https://plure.example.com");
    assert.deepEqual(tokenSpec.args, [
      "tunnel",
      "--no-autoupdate",
      "run",
      "--token",
      "eyJ_sample_token",
    ]);

    const namedSpec = resolveTunnelSpawnSpec(4310, {
      PLURE_CF_TUNNEL_NAME: "plure-prod",
      PLURE_CF_CONFIG_PATH: "C:\\Users\\fauza\\.cloudflared\\plure.yml",
      PLURE_CF_PUBLIC_URL: "https://plure.example.com",
    });
    assert.equal(namedSpec.mode, "named-config");
    assert.equal(namedSpec.configuredPublicUrl, "https://plure.example.com");
    assert.deepEqual(namedSpec.args, [
      "tunnel",
      "--config",
      "C:\\Users\\fauza\\.cloudflared\\plure.yml",
      "--no-autoupdate",
      "run",
      "plure-prod",
    ]);

    const quickSpec = resolveTunnelSpawnSpec(4310, {});
    assert.equal(quickSpec.mode, "quick");
    assert.equal(quickSpec.configuredPublicUrl, null);
  });
});
