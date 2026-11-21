import { ProviderDriverKind, ProviderInstanceId, type ServerProvider } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import {
  buildCooPrompt,
  resolveCooModelSelection,
  resolveCooRoleEntry,
  validateCooLaunch,
} from "./CooDashboard.logic";

function model(slug: string, isDefault = false): ServerProvider["models"][number] {
  return {
    slug,
    name: slug,
    isCustom: false,
    ...(isDefault ? { isDefault: true } : {}),
    capabilities: {},
  };
}

function provider(input: {
  driver: string;
  instanceId: string;
  displayName: string;
  models?: ServerProvider["models"];
  enabled?: boolean;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.displayName,
    enabled: input.enabled ?? true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: input.models ?? [model("default", true)],
    slashCommands: [],
    skills: [],
  };
}

const devin = provider({
  driver: "acpRegistry",
  instanceId: "devin-local",
  displayName: "Devin",
  models: [model("default", true), model("kimi-k3.1-pro-max")],
});
const claude = provider({
  driver: "claudeAgent",
  instanceId: "claude",
  displayName: "Claude",
  models: [model("claude-sonnet-5", true)],
});
const antigravity = provider({
  driver: "antigravity",
  instanceId: "antigravity",
  displayName: "Antigravity",
  models: [model("gemini-3.3-pro", true)],
});
const providers = [devin, claude, antigravity];

describe("COO role defaults", () => {
  it("prefers Devin, Claude, and Antigravity for their respective roles", () => {
    const entries = deriveProviderInstanceEntries(providers);

    expect(resolveCooRoleEntry({ entries, role: "coordinator" })?.instanceId).toBe("devin-local");
    expect(resolveCooRoleEntry({ entries, role: "implementation" })?.instanceId).toBe("claude");
    expect(resolveCooRoleEntry({ entries, role: "research" })?.instanceId).toBe("antigravity");
  });

  it("falls back to a ready provider instead of an unavailable preferred one", () => {
    const codex = provider({
      driver: "codex",
      instanceId: "codex",
      displayName: "Codex",
      models: [model("gpt-6", true)],
    });
    const entries = deriveProviderInstanceEntries([{ ...devin, enabled: false }, codex]);

    expect(resolveCooRoleEntry({ entries, role: "coordinator" })?.instanceId).toBe("codex");
  });

  it("selects Kimi K3.1 Pro Max when Devin advertises it", () => {
    const [entry] = deriveProviderInstanceEntries([devin]);

    expect(resolveCooModelSelection({ entry: entry!, providers, preferKimi: true })).toEqual({
      instanceId: ProviderInstanceId.make("devin-local"),
      model: "kimi-k3.1-pro-max",
    });
  });

  it("uses the real Devin default when the preferred Kimi model is absent", () => {
    const fallbackDevin = {
      ...devin,
      models: [model("kimi-k2.5", true)],
    };
    const [entry] = deriveProviderInstanceEntries([fallbackDevin]);

    expect(
      resolveCooModelSelection({
        entry: entry!,
        providers: [fallbackDevin],
        preferKimi: true,
      }),
    ).toEqual({
      instanceId: ProviderInstanceId.make("devin-local"),
      model: "kimi-k2.5",
    });
  });
});

describe("COO launch", () => {
  const coordinator = {
    instanceId: ProviderInstanceId.make("devin-local"),
    model: "kimi-k3.1-pro-max",
  };
  const implementation = {
    instanceId: ProviderInstanceId.make("claude"),
    model: "claude-sonnet-5",
  };
  const research = {
    instanceId: ProviderInstanceId.make("antigravity"),
    model: "gemini-3.3-pro",
  };

  it("rejects an empty objective before creating a draft", () => {
    expect(validateCooLaunch({ objective: "  ", coordinator, implementation, research })).toBe(
      "objective-required",
    );
  });

  it("names every missing role selection", () => {
    expect(
      validateCooLaunch({ objective: "Fix tests", coordinator: null, implementation, research }),
    ).toBe("coordinator-required");
    expect(
      validateCooLaunch({ objective: "Fix tests", coordinator, implementation: null, research }),
    ).toBe("implementation-required");
    expect(
      validateCooLaunch({ objective: "Fix tests", coordinator, implementation, research: null }),
    ).toBe("research-required");
  });

  it("accepts a complete launch", () => {
    expect(
      validateCooLaunch({ objective: "Fix tests", coordinator, implementation, research }),
    ).toBe("ok");
  });

  it("builds delegation instructions with exact worker targets and safe isolation", () => {
    const prompt = buildCooPrompt({
      objective: "Fix authentication tests",
      coordinator,
      implementation,
      research,
    });

    expect(prompt).toContain("Fix authentication tests");
    expect(prompt).toContain("orchestrator_capabilities");
    expect(prompt).toContain("delegate_task");
    expect(prompt).toContain('providerInstanceId: "claude"');
    expect(prompt).toContain('model: "claude-sonnet-5"');
    expect(prompt).toContain('providerInstanceId: "antigravity"');
    expect(prompt).toContain('model: "gemini-3.3-pro"');
    expect(prompt).toContain('isolation: "worktree"');
    expect(prompt).toContain("Workers must not delegate further");
    expect(prompt).toContain("Never include secrets");
  });
});
