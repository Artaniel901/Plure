import {
  DEFAULT_UNIFIED_SETTINGS,
  EnvironmentId,
  ProjectId,
  ProviderDriverKind,
  ProviderInstanceId,
  type ServerProvider,
} from "@t3tools/contracts";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import { userEvent } from "vite-plus/test/browser";
import { expect, it, vi } from "vite-plus/test";

import { deriveProviderInstanceEntries } from "../../providerInstances";
import { render } from "../../../test/render";
import { CooDashboardView, type CooDashboardViewProps, type CooLaunchInput } from "./CooDashboard";

vi.mock("../chat/ProviderModelPicker", () => ({
  ProviderModelPicker: (props: {
    triggerAriaLabel?: string;
    onInstanceModelChange: (instanceId: ProviderInstanceId, model: string) => void;
  }) => (
    <button
      type="button"
      aria-label={props.triggerAriaLabel}
      onClick={() =>
        props.onInstanceModelChange(ProviderInstanceId.make("claude"), "claude-opus-5-5")
      }
    >
      Change model
    </button>
  ),
}));

function provider(input: {
  driver: string;
  instanceId: string;
  displayName: string;
  model: string;
}): ServerProvider {
  return {
    instanceId: ProviderInstanceId.make(input.instanceId),
    driver: ProviderDriverKind.make(input.driver),
    displayName: input.displayName,
    enabled: true,
    installed: true,
    version: null,
    status: "ready",
    auth: { status: "authenticated" },
    checkedAt: "2026-01-01T00:00:00.000Z",
    models: [
      {
        slug: input.model,
        name: input.model,
        isCustom: false,
        isDefault: true,
        capabilities: {},
      },
    ],
    slashCommands: [],
    skills: [],
  };
}

const providers = [
  provider({
    driver: "acpRegistry",
    instanceId: "devin-local",
    displayName: "Devin",
    model: "kimi-k3.1-pro-max",
  }),
  provider({
    driver: "claudeAgent",
    instanceId: "claude",
    displayName: "Claude",
    model: "claude-sonnet-5",
  }),
  provider({
    driver: "antigravity",
    instanceId: "antigravity",
    displayName: "Antigravity",
    model: "gemini-3.3-pro",
  }),
];

const projectRef = scopeProjectRef(EnvironmentId.make("env-1"), ProjectId.make("project-1"));

function props(overrides: Partial<CooDashboardViewProps> = {}): CooDashboardViewProps {
  return {
    projects: [{ ref: projectRef, title: "Storefront", workspaceRoot: "D:/storefront" }],
    selectedProjectRef: projectRef,
    threads: [],
    providers,
    instanceEntries: deriveProviderInstanceEntries(providers),
    settings: DEFAULT_UNIFIED_SETTINGS,
    defaultSelections: {
      coordinator: {
        instanceId: ProviderInstanceId.make("devin-local"),
        model: "kimi-k3.1-pro-max",
      },
      implementation: {
        instanceId: ProviderInstanceId.make("claude"),
        model: "claude-sonnet-5",
      },
      research: {
        instanceId: ProviderInstanceId.make("antigravity"),
        model: "gemini-3.3-pro",
      },
    },
    onProjectChange: () => undefined,
    onOpenThread: () => undefined,
    onOpenProviders: () => undefined,
    onAddProject: () => undefined,
    onLaunch: async () => undefined,
    ...overrides,
  };
}

it("shows provider setup guidance when no compatible provider is ready", async () => {
  const onOpenProviders = vi.fn();
  await using screen = await render(
    <CooDashboardView
      {...props({
        providers: [],
        instanceEntries: [],
        defaultSelections: { coordinator: null, implementation: null, research: null },
        onOpenProviders,
      })}
    />,
  );

  await expect.element(screen.getByText("No compatible providers are ready")).toBeVisible();
  await screen.getByRole("button", { name: "Set up providers" }).click();
  expect(onOpenProviders).toHaveBeenCalledOnce();
});

it("requires an objective before launching", async () => {
  const onLaunch = vi.fn(async (_input: CooLaunchInput) => undefined);
  await using screen = await render(<CooDashboardView {...props({ onLaunch })} />);

  await screen.getByRole("button", { name: "Open COO draft" }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Enter an objective before opening the COO draft.");
  expect(onLaunch).not.toHaveBeenCalled();
});

it("shows an actionable error when draft creation fails", async () => {
  const onLaunch = vi.fn(async (_input: CooLaunchInput) => {
    throw new Error("offline");
  });
  await using screen = await render(<CooDashboardView {...props({ onLaunch })} />);

  await screen.getByRole("textbox", { name: "Objective" }).fill("Fix authentication tests");
  await screen.getByRole("button", { name: "Open COO draft" }).click();

  await expect
    .element(screen.getByRole("alert"))
    .toHaveTextContent("Could not open the COO draft. Try again.");
});

it("launches with the actual changed worker model", async () => {
  const onLaunch = vi.fn(async (_input: CooLaunchInput) => undefined);
  await using screen = await render(<CooDashboardView {...props({ onLaunch })} />);

  await screen.getByRole("textbox", { name: "Objective" }).fill("Fix authentication tests");
  await screen.getByRole("button", { name: "Implementation model" }).click();
  await screen.getByRole("button", { name: "Open COO draft" }).click();

  expect(onLaunch).toHaveBeenCalledWith({
    objective: "Fix authentication tests",
    coordinator: {
      instanceId: ProviderInstanceId.make("devin-local"),
      model: "kimi-k3.1-pro-max",
    },
    implementation: {
      instanceId: ProviderInstanceId.make("claude"),
      model: "claude-opus-5-5",
    },
    research: {
      instanceId: ProviderInstanceId.make("antigravity"),
      model: "gemini-3.3-pro",
    },
  });
});

it("offers project creation instead of a dead launch form when no project exists", async () => {
  const onAddProject = vi.fn();
  await using screen = await render(
    <CooDashboardView {...props({ projects: [], selectedProjectRef: null, onAddProject })} />,
  );

  await expect.element(screen.getByText("Add a repository before starting the COO")).toBeVisible();
  await screen.getByRole("button", { name: "Add project" }).click();
  expect(onAddProject).toHaveBeenCalledOnce();
});

it("keeps the launch form usable with keyboard input", async () => {
  await using screen = await render(<CooDashboardView {...props()} />);
  const objective = screen.getByRole("textbox", { name: "Objective" });

  await objective.click();
  await userEvent.keyboard("Review the repository");

  await expect.element(objective).toHaveValue("Review the repository");
});
