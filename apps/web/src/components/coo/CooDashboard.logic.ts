import type { ModelSelection, ServerProvider } from "@t3tools/contracts";
import { msg } from "gt-react";

import { m } from "../../i18n/messages";
import {
  getDefaultProviderInstanceModel,
  isProviderInstancePickerReady,
  type ProviderInstanceEntry,
} from "../../providerInstances";

export type CooRole = "coordinator" | "implementation" | "research";
export type CooSelections = Readonly<Record<CooRole, ModelSelection | null>>;
export type CooLaunchInput = CooSelections & { readonly objective: string };
export type CooLaunchIssue =
  | "ok"
  | "objective-required"
  | "coordinator-required"
  | "implementation-required"
  | "research-required";

function isPreferredEntry(entry: ProviderInstanceEntry, role: CooRole): boolean {
  switch (role) {
    case "coordinator": {
      const name = entry.displayName.toLowerCase();
      return (
        entry.acpRegistryAgentId === "devin" ||
        (entry.driverKind === "acpRegistry" && name.includes("devin")) ||
        entry.driverKind === "devin"
      );
    }
    case "implementation":
      return entry.driverKind === "claudeAgent";
    case "research":
      return entry.driverKind === "antigravity";
  }
}

export function resolveCooRoleEntry(input: {
  readonly entries: ReadonlyArray<ProviderInstanceEntry>;
  readonly role: CooRole;
}): ProviderInstanceEntry | null {
  const ready = input.entries.filter(isProviderInstancePickerReady);
  return ready.find((entry) => isPreferredEntry(entry, input.role)) ?? ready[0] ?? null;
}

function isPreferredKimiModel(model: ServerProvider["models"][number]): boolean {
  const text = `${model.slug} ${model.name}`.toLowerCase();
  return (
    text.includes("kimi") && text.includes("3.1") && text.includes("pro") && text.includes("max")
  );
}

export function resolveCooModelSelection(input: {
  readonly entry: ProviderInstanceEntry | null;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly preferKimi?: boolean;
}): ModelSelection | null {
  if (input.entry === null) return null;
  const preferred =
    input.preferKimi === true ? input.entry.models.find(isPreferredKimiModel) : undefined;
  const model =
    preferred?.slug ?? getDefaultProviderInstanceModel(input.providers, input.entry.instanceId);
  return model === undefined ? null : { instanceId: input.entry.instanceId, model };
}

export function validateCooLaunch(input: CooLaunchInput): CooLaunchIssue {
  if (input.objective.trim().length === 0) return "objective-required";
  if (input.coordinator === null) return "coordinator-required";
  if (input.implementation === null) return "implementation-required";
  if (input.research === null) return "research-required";
  return "ok";
}

export function buildCooPrompt(input: CooSelections & { readonly objective: string }): string {
  const objective = input.objective.trim();
  const coordinator = input.coordinator;
  const implementation = input.implementation;
  const research = input.research;
  if (coordinator === null || implementation === null || research === null) {
    throw new Error(m(msg("COO launch requires all role selections")));
  }

  // oxlint-disable-next-line t3code/no-untranslated-copy -- instructions sent to the COO agent, not shown as UI copy
  return `You are the COO for this repository. Coordinate the coding work and own the final result.

Objective:
${objective}

This thread is configured with providerInstanceId: "${coordinator.instanceId}" and model: "${coordinator.model}".

Before delegating, call orchestrator_capabilities and confirm these worker targets are available:
- Implementation: providerInstanceId: "${implementation.instanceId}", model: "${implementation.model}"
- Research and review: providerInstanceId: "${research.instanceId}", model: "${research.model}"

Use delegate_task for bounded implementation, research, review, and test work. For parallel file edits, use isolation: "worktree". Read-only research and review may use the shared checkout. Give each worker a single clear owner and keep task IDs. Workers must not delegate further.

Never include secrets in a task. Preserve the thread's permission mode and ask before destructive operations. Review worker results, verify the real entry point, and report what was verified and what remains unverified.`;
}
