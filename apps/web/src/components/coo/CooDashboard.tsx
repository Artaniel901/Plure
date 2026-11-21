import { useAtomValue } from "@effect/atom-react";
import { scopeProjectRef } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import {
  DEFAULT_SERVER_SETTINGS,
  type ModelSelection,
  type ProviderInstanceId,
  type ScopedProjectRef,
  type ServerProvider,
  type ServerSettings,
} from "@t3tools/contracts";
import { type UnifiedSettings } from "@t3tools/contracts/settings";
import { useNavigate } from "@tanstack/react-router";
import { Atom } from "effect/reactivity";
import { msg, T, useGT } from "gt-react";
import { ChevronRightIcon, PlusIcon, WorkflowIcon } from "lucide-react";
import { useRef, useState, type FormEvent, type ReactNode } from "react";

import { openCommandPalette } from "../../commandPaletteBus";
import { useComposerDraftStore } from "../../composerDraftStore";
import { m } from "../../i18n/messages";
import { useNewThreadHandler } from "../../hooks/useHandleNewThread";
import { useMergedSettings } from "../../hooks/useSettings";
import { getAppModelOptionsForInstance } from "../../modelSelection";
import {
  isProviderInstancePickerReady,
  providerInstanceEntriesFor,
  type ProviderInstanceEntry,
} from "../../providerInstances";
import {
  useAllEnvironmentShellsBootstrapped,
  useProjects,
  useVisibleThreadShells,
} from "../../state/entities";
import { useEnvironmentProviders } from "../../state/environments";
import { serverEnvironment } from "../../state/server";
import { AppRouteModal, AppRouteModalClose } from "../AppRouteModal";
import { WorkspaceBreadcrumb, WorkspaceBreadcrumbItem } from "../WorkspaceBreadcrumb";
import { WorkspacePageContainer } from "../WorkspacePageContainer";
import { ProviderModelPicker } from "../chat/ProviderModelPicker";
import { placeLinkedPrompt } from "../promptLinks/linkedPrompt";
import { sortScopedProjectsForSidebar } from "../Sidebar.logic";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from "../ui/empty";
import { ScrollArea } from "../ui/scroll-area";
import { Select, SelectItem, SelectPopup, SelectTrigger, SelectValue } from "../ui/select";
import { Textarea } from "../ui/textarea";
import {
  buildCooPrompt,
  resolveCooModelSelection,
  resolveCooRoleEntry,
  validateCooLaunch,
  type CooLaunchInput,
  type CooRole,
  type CooSelections,
} from "./CooDashboard.logic";

export type { CooLaunchInput } from "./CooDashboard.logic";

export interface CooProjectOption {
  readonly ref: ScopedProjectRef;
  readonly title: string;
  readonly workspaceRoot: string;
}

export type CooThreadItem = Pick<
  EnvironmentThreadShell,
  | "environmentId"
  | "id"
  | "title"
  | "runtime"
  | "providerInstanceId"
  | "modelSelection"
  | "updatedAt"
>;

export interface CooDashboardViewProps {
  readonly projects: ReadonlyArray<CooProjectOption>;
  readonly selectedProjectRef: ScopedProjectRef | null;
  readonly threads: ReadonlyArray<CooThreadItem>;
  readonly providers: ReadonlyArray<ServerProvider>;
  readonly instanceEntries: ReadonlyArray<ProviderInstanceEntry>;
  readonly settings: UnifiedSettings;
  readonly defaultSelections: CooSelections;
  readonly loading?: boolean;
  readonly headerAction?: ReactNode;
  readonly onProjectChange: (ref: ScopedProjectRef) => void;
  readonly onOpenThread: (thread: CooThreadItem) => void;
  readonly onOpenProviders: (instanceId?: ProviderInstanceId) => void;
  readonly onAddProject: () => void;
  readonly onLaunch: (input: CooLaunchInput) => Promise<void>;
}

const ROLES: ReadonlyArray<CooRole> = ["coordinator", "implementation", "research"];

function roleCopy(role: CooRole, gt: ReturnType<typeof useGT>) {
  switch (role) {
    case "coordinator":
      return {
        label: gt("COO"),
        description: gt(
          "Coordinates the work and verifies the result. Prefer Devin with Kimi K3.1 Pro Max.",
        ),
      };
    case "implementation":
      return {
        label: gt("Implementation"),
        description: gt(
          "Edits code, runs focused checks, and owns implementation tasks. Prefer Claude.",
        ),
      };
    case "research":
      return {
        label: gt("Research & review"),
        description: gt("Investigates the repository and reviews changes. Prefer Antigravity."),
      };
  }
}

function projectKey(ref: ScopedProjectRef): string {
  return `${ref.environmentId}:${ref.projectId}`;
}

function launchIssueText(issue: ReturnType<typeof validateCooLaunch> | "launch-failed"): string {
  switch (issue) {
    case "objective-required":
      return m(msg("Enter an objective before opening the COO draft."));
    case "coordinator-required":
      return m(msg("Choose a COO provider and model."));
    case "implementation-required":
      return m(msg("Choose an implementation provider and model."));
    case "research-required":
      return m(msg("Choose a research provider and model."));
    case "launch-failed":
      return m(msg("Could not open the COO draft. Try again."));
    case "ok":
      return "";
  }
}

export function CooDashboardView(props: CooDashboardViewProps) {
  const gt = useGT();
  const [objective, setObjective] = useState("");
  const objectiveRef = useRef<HTMLTextAreaElement>(null);
  const [overrides, setOverrides] = useState<Partial<Record<CooRole, ModelSelection>>>({});
  const [issue, setIssue] = useState<ReturnType<typeof validateCooLaunch> | "launch-failed" | null>(
    null,
  );
  const [launching, setLaunching] = useState(false);
  const selections: CooSelections = {
    coordinator: overrides.coordinator ?? props.defaultSelections.coordinator,
    implementation: overrides.implementation ?? props.defaultSelections.implementation,
    research: overrides.research ?? props.defaultSelections.research,
  };
  const selectedProjectRef = props.selectedProjectRef;
  const selectedProject =
    selectedProjectRef === null
      ? null
      : (props.projects.find(
          (project) => projectKey(project.ref) === projectKey(selectedProjectRef),
        ) ?? null);
  const modelOptionsByInstance = new Map(
    props.instanceEntries.map((entry) => {
      const selected = Object.values(selections).find(
        (selection) => selection?.instanceId === entry.instanceId,
      );
      return [
        entry.instanceId,
        getAppModelOptionsForInstance(props.settings, entry, selected?.model ?? null),
      ] as const;
    }),
  );
  const readyEntries = props.instanceEntries.filter(isProviderInstancePickerReady);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextIssue = validateCooLaunch({ objective, ...selections });
    setIssue(nextIssue);
    if (nextIssue !== "ok") {
      if (nextIssue === "objective-required") objectiveRef.current?.focus();
      return;
    }
    setLaunching(true);
    try {
      await props.onLaunch({ objective, ...selections });
    } catch {
      setIssue("launch-failed");
    } finally {
      setLaunching(false);
    }
  };

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex min-h-12 shrink-0 items-center gap-2 border-b ps-5 pe-2">
        <WorkspaceBreadcrumb ariaLabel={gt("COO breadcrumb")}>
          <WorkspaceBreadcrumbItem current>
            <h1 className="text-sm font-medium">COO</h1>
          </WorkspaceBreadcrumbItem>
        </WorkspaceBreadcrumb>
        <div className="ms-auto">{props.headerAction}</div>
      </header>
      <ScrollArea className="min-h-0 flex-1" scrollFade>
        <WorkspacePageContainer width="expanded" className="@container/main gap-8 pb-16">
          <section aria-labelledby="coo-heading" className="max-w-3xl">
            <h2 id="coo-heading" className="text-balance text-xl font-semibold tracking-tight">
              <T>Coordinate repository work</T>
            </h2>
            <p className="mt-2 text-pretty text-sm leading-6 text-muted-foreground">
              <T>
                Open a reviewed COO draft, then let it delegate bounded coding, research, and review
                tasks through T3 Code.
              </T>
            </p>
          </section>

          {props.loading ? (
            <div
              role="status"
              className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground"
            >
              <T>Loading projects and provider status...</T>
            </div>
          ) : props.projects.length === 0 ? (
            <div className="rounded-xl border border-dashed">
              <Empty size="compact">
                <EmptyHeader>
                  <EmptyTitle>
                    <T>Add a repository before starting the COO</T>
                  </EmptyTitle>
                  <EmptyDescription>
                    <T>
                      The COO and its workers need a project where they can read and edit files.
                    </T>
                  </EmptyDescription>
                  <Button size="sm" className="mt-5" onClick={props.onAddProject}>
                    <PlusIcon />
                    <T>Add project</T>
                  </Button>
                </EmptyHeader>
              </Empty>
            </div>
          ) : (
            <form
              aria-labelledby="coo-launch-heading"
              className="flex flex-col gap-7"
              noValidate
              onSubmit={submit}
            >
              <h3 id="coo-launch-heading" className="sr-only">
                <T>Configure COO orchestration</T>
              </h3>
              <div className="grid gap-2">
                <label htmlFor="coo-project" className="text-sm font-medium">
                  <T>Repository</T>
                </label>
                <Select
                  value={
                    props.selectedProjectRef ? projectKey(props.selectedProjectRef) : undefined
                  }
                  onValueChange={(value) => {
                    const project = props.projects.find(
                      (candidate) => projectKey(candidate.ref) === value,
                    );
                    if (!project) return;
                    setOverrides({});
                    setIssue(null);
                    props.onProjectChange(project.ref);
                  }}
                >
                  <SelectTrigger id="coo-project" name="project" className="w-full sm:max-w-xl">
                    <SelectValue placeholder={gt("Choose a repository")}>
                      {selectedProject ? (
                        <span className="min-w-0">
                          <span className="block truncate">{selectedProject.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {selectedProject.workspaceRoot}
                          </span>
                        </span>
                      ) : null}
                    </SelectValue>
                  </SelectTrigger>
                  <SelectPopup>
                    {props.projects.map((project) => (
                      <SelectItem key={projectKey(project.ref)} value={projectKey(project.ref)}>
                        <span className="min-w-0">
                          <span className="block truncate">{project.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {project.workspaceRoot}
                          </span>
                        </span>
                      </SelectItem>
                    ))}
                  </SelectPopup>
                </Select>
              </div>

              <fieldset className="min-w-0">
                <legend className="mb-3 text-sm font-medium">
                  <T>COO and workers</T>
                </legend>
                <div className="grid grid-cols-1 gap-3 @5xl/main:grid-cols-3">
                  {ROLES.map((role) => {
                    const copy = roleCopy(role, gt);
                    const selection = selections[role];
                    const entry = selection
                      ? props.instanceEntries.find(
                          (candidate) => candidate.instanceId === selection.instanceId,
                        )
                      : null;
                    return (
                      <section
                        key={role}
                        aria-label={copy.label}
                        className="flex min-w-0 flex-col gap-3 rounded-xl border bg-card p-4"
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h4 className="min-w-0 text-sm font-medium">{copy.label}</h4>
                            {entry ? (
                              <Badge
                                variant={
                                  isProviderInstancePickerReady(entry) ? "success" : "warning"
                                }
                                size="sm"
                              >
                                {isProviderInstancePickerReady(entry)
                                  ? gt("Ready")
                                  : gt("Check setup")}
                              </Badge>
                            ) : null}
                          </div>
                          <p className="mt-1 text-pretty text-xs leading-5 text-muted-foreground">
                            {copy.description}
                          </p>
                        </div>
                        {selection && props.selectedProjectRef ? (
                          <ProviderModelPicker
                            environmentId={props.selectedProjectRef.environmentId}
                            workspaceCwd={selectedProject?.workspaceRoot ?? null}
                            activeInstanceId={selection.instanceId}
                            model={selection.model}
                            lockedProvider={null}
                            instanceEntries={props.instanceEntries}
                            modelOptionsByInstance={modelOptionsByInstance}
                            triggerAriaLabel={gt("{role} model", { role: copy.label })}
                            onOpenProviderSetup={props.onOpenProviders}
                            onInstanceModelChange={(instanceId, model) => {
                              setOverrides((current) => ({
                                ...current,
                                [role]: { instanceId, model },
                              }));
                              setIssue(null);
                            }}
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => props.onOpenProviders()}
                          >
                            <T>Choose provider</T>
                          </Button>
                        )}
                      </section>
                    );
                  })}
                </div>
              </fieldset>

              {readyEntries.length === 0 ? (
                <div className="flex flex-wrap items-center gap-3 rounded-lg border border-dashed p-4">
                  <p className="min-w-0 flex-1 text-sm text-muted-foreground">
                    <T>No compatible providers are ready</T>
                  </p>
                  <Button size="sm" variant="outline" onClick={() => props.onOpenProviders()}>
                    <T>Set up providers</T>
                  </Button>
                </div>
              ) : null}

              <div className="grid gap-2">
                <label htmlFor="coo-objective" className="text-sm font-medium">
                  <T>Objective</T>
                </label>
                <Textarea
                  ref={objectiveRef}
                  id="coo-objective"
                  name="objective"
                  rows={4}
                  required
                  maxLength={8000}
                  value={objective}
                  aria-invalid={issue === "objective-required"}
                  aria-describedby={issue ? "coo-launch-error" : undefined}
                  placeholder={gt("Describe the repository outcome you want")}
                  onChange={(event) => {
                    setObjective(event.target.value);
                    if (issue === "objective-required" || issue === "launch-failed") setIssue(null);
                  }}
                />
                <p className="text-xs text-muted-foreground">
                  <T>Nothing is sent until you review the generated prompt in the draft.</T>
                </p>
              </div>

              {issue ? (
                <p
                  id="coo-launch-error"
                  role="alert"
                  className="text-sm text-destructive-foreground"
                >
                  {launchIssueText(issue)}
                </p>
              ) : null}

              <div className="flex flex-wrap items-center gap-3">
                <Button type="submit" size="lg" disabled={launching} aria-busy={launching}>
                  <WorkflowIcon />
                  {launching ? gt("Opening draft...") : gt("Open COO draft")}
                </Button>
                <Button
                  type="button"
                  size="lg"
                  variant="ghost"
                  onClick={() => props.onOpenProviders()}
                >
                  <T>Provider settings</T>
                </Button>
              </div>
            </form>
          )}

          <section aria-labelledby="coo-recent-heading" className="min-w-0">
            <h3 id="coo-recent-heading" className="text-sm font-medium">
              <T>Recent project threads</T>
            </h3>
            {props.threads.length === 0 ? (
              <p className="mt-3 text-sm text-muted-foreground">
                <T>No threads in this project yet.</T>
              </p>
            ) : (
              <ul className="mt-3 divide-y rounded-xl border">
                {props.threads.map((thread) => (
                  <li key={`${thread.environmentId}:${thread.id}`} className="min-w-0">
                    <Button
                      variant="ghost"
                      size="multiline"
                      className="w-full min-w-0 justify-start text-left"
                      onClick={() => props.onOpenThread(thread)}
                    >
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{thread.title}</span>
                        <span className="mt-1 block truncate text-xs text-muted-foreground">
                          {thread.modelSelection.model}
                        </span>
                      </span>
                      <Badge variant="outline" size="sm">
                        {thread.runtime?.status ?? gt("idle")}
                      </Badge>
                      <ChevronRightIcon className="shrink-0 text-muted-foreground" />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </WorkspacePageContainer>
      </ScrollArea>
    </div>
  );
}

const noEnvironmentSettingsAtom = Atom.make<ServerSettings | null>(null);

export function CooDashboard() {
  const gt = useGT();
  const navigate = useNavigate();
  const projects = useProjects();
  const threads = useVisibleThreadShells();
  const providersByEnvironment = useEnvironmentProviders();
  const bootstrapped = useAllEnvironmentShellsBootstrapped();
  const handleNewThread = useNewThreadHandler();
  const [selectedRef, setSelectedRef] = useState<ScopedProjectRef | null>(null);
  const activeProjects = sortScopedProjectsForSidebar(
    projects.filter((project) => project.archivedAt == null && project.isScratch !== true),
    threads,
    "updated_at",
  ).map((project) => ({
    ref: scopeProjectRef(project.environmentId, project.id),
    title: project.title,
    workspaceRoot: project.workspaceRoot,
  }));
  const selectedProject =
    (selectedRef === null
      ? undefined
      : activeProjects.find((project) => projectKey(project.ref) === projectKey(selectedRef))) ??
    activeProjects[0] ??
    null;
  const environmentId = selectedProject?.ref.environmentId ?? null;
  const serverSettings = useAtomValue(
    environmentId ? serverEnvironment.settingsValueAtom(environmentId) : noEnvironmentSettingsAtom,
  );
  const settings = useMergedSettings(serverSettings ?? DEFAULT_SERVER_SETTINGS);
  const providers = (environmentId ? providersByEnvironment.get(environmentId) : undefined) ?? [];
  const instanceEntries = providerInstanceEntriesFor(
    providers,
    settings,
    selectedProject?.ref.projectId ?? null,
  );
  const defaultSelections: CooSelections = {
    coordinator: resolveCooModelSelection({
      entry: resolveCooRoleEntry({ entries: instanceEntries, role: "coordinator" }),
      providers,
      preferKimi: true,
    }),
    implementation: resolveCooModelSelection({
      entry: resolveCooRoleEntry({ entries: instanceEntries, role: "implementation" }),
      providers,
    }),
    research: resolveCooModelSelection({
      entry: resolveCooRoleEntry({ entries: instanceEntries, role: "research" }),
      providers,
    }),
  };
  const projectThreads = selectedProject
    ? threads
        .filter(
          (thread) =>
            thread.environmentId === selectedProject.ref.environmentId &&
            thread.projectId === selectedProject.ref.projectId,
        )
        .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
        .slice(0, 6)
    : [];

  const openProviders = (instanceId?: ProviderInstanceId) => {
    void navigate({
      to: "/settings/providers",
      search: {
        ...(environmentId ? { environmentId } : {}),
        ...(instanceId ? { instanceId } : {}),
      },
    });
  };

  const launch = async (input: CooLaunchInput) => {
    if (selectedProject === null || validateCooLaunch(input) !== "ok") {
      throw new Error(m(msg("Invalid COO launch")));
    }
    const opened = await handleNewThread(selectedProject.ref);
    if (opened === null) throw new Error(m(msg("Could not open COO draft")));
    useComposerDraftStore.getState().setModelSelection(opened.draftId, input.coordinator, {
      explicit: true,
      replaceOptions: true,
    });
    placeLinkedPrompt(opened.draftId, { text: buildCooPrompt(input), hiddenCharacters: 0 });
  };

  return (
    <AppRouteModal label={gt("COO orchestration")}>
      <CooDashboardView
        projects={activeProjects}
        selectedProjectRef={selectedProject?.ref ?? null}
        threads={projectThreads}
        providers={providers}
        instanceEntries={instanceEntries}
        settings={settings}
        defaultSelections={defaultSelections}
        loading={!bootstrapped}
        headerAction={<AppRouteModalClose />}
        onProjectChange={setSelectedRef}
        onOpenThread={(thread) => {
          void navigate({
            to: "/$environmentId/$threadId",
            params: { environmentId: thread.environmentId, threadId: thread.id },
          });
        }}
        onOpenProviders={openProviders}
        onAddProject={() => openCommandPalette({ open: "add-project" })}
        onLaunch={launch}
      />
    </AppRouteModal>
  );
}
