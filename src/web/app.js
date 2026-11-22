import { createOrbitalBackdrop } from "./backdrop.js";

const ROLES = ["coo", "implementer", "researcher"];

const state = {
  roles: {},
  providers: [],
  workspaces: [],
  missions: [],
  selectedWorkspaceId: "",
  theme: localStorage.getItem("plure_theme") === "light" ? "light" : "dark",
};

const el = (id) => document.getElementById(id);

const backdrop = createOrbitalBackdrop(el("plure-backdrop"));

function applyTheme(theme) {
  state.theme = theme === "light" ? "light" : "dark";
  document.documentElement.setAttribute("data-theme", state.theme);
  localStorage.setItem("plure_theme", state.theme);
  el("btn-toggle-theme").textContent =
    state.theme === "dark" ? "Theme: Dark" : "Theme: Light";
  backdrop.setTheme(state.theme);
}

function updateMotionButton() {
  const on = backdrop.isEnabled();
  const btn = el("btn-toggle-motion");
  btn.setAttribute("aria-pressed", String(on));
  btn.textContent = on ? "Motion: On" : "Motion: Paused";
}

async function apiRequest(url, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (options.method && options.method !== "GET") {
    headers["X-Plure-Request"] = "1";
    headers["Content-Type"] = "application/json";
  }
  const res = await fetch(url, { ...options, headers });
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(payload.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return payload;
}

function showError(targetId, message) {
  const box = el(targetId);
  if (!message) {
    box.hidden = true;
    box.textContent = "";
    return;
  }
  box.hidden = false;
  box.textContent = message;
}

function renderRoleSelectors() {
  for (const role of ROLES) {
    const providerSelect = el(`provider-${role}`);
    const modelSelect = el(`model-${role}`);
    const badge = el(`badge-${role}`);
    const current = state.roles[role];
    if (!current) continue;

    providerSelect.replaceChildren(
      ...state.providers.map((p) => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = `${p.name} (${p.authenticated ? "Ready" : "Plan Sim"})`;
        opt.selected = p.id === current.providerId;
        return opt;
      }),
    );

    const activeProvider =
      state.providers.find((p) => p.id === current.providerId) || state.providers[0];
    const models = activeProvider ? activeProvider.models : [];
    const hasCurrentModel = models.some((m) => m.id === current.model);
    const modelItems = hasCurrentModel
      ? models
      : [{ id: current.model, label: current.model, tier: "Custom" }, ...models];

    modelSelect.replaceChildren(
      ...modelItems.map((m) => {
        const opt = document.createElement("option");
        opt.value = m.id;
        opt.textContent = m.label;
        opt.selected = m.id === current.model;
        return opt;
      }),
    );

    if (activeProvider) {
      badge.textContent = `${activeProvider.name}: ${current.model}`;
    }
  }
}

function renderWorkspaces() {
  const select = el("select-workspace");
  const pill = el("repo-pill");
  const summary = el("repo-summary");

  if (state.workspaces.length === 0) {
    select.replaceChildren();
    const emptyOpt = document.createElement("option");
    emptyOpt.value = "";
    emptyOpt.textContent = "No repositories registered yet";
    select.append(emptyOpt);
    pill.textContent = "No repository";
    summary.textContent =
      "No Git repositories registered yet. Add a host repository path above to start orchestrating code.";
    return;
  }

  if (!state.workspaces.some((w) => w.id === state.selectedWorkspaceId)) {
    state.selectedWorkspaceId = state.workspaces[0].id;
  }

  select.replaceChildren(
    ...state.workspaces.map((ws) => {
      const opt = document.createElement("option");
      opt.value = ws.id;
      opt.textContent = `${ws.label} (${ws.branch}) : ${ws.rootPath}`;
      opt.selected = ws.id === state.selectedWorkspaceId;
      return opt;
    }),
  );

  const active = state.workspaces.find((w) => w.id === state.selectedWorkspaceId);
  if (!active) return;

  pill.textContent = `${active.label} [${active.branch} @ ${active.headSha}] (${active.changedFiles.length} modified)`;

  summary.replaceChildren();
  const meta = document.createElement("p");
  meta.className = "muted-copy";
  meta.textContent = `Active path: ${active.rootPath} | Branch: ${active.branch} (${active.headSha})`;
  summary.append(meta);

  if (active.changedFiles.length === 0) {
    const cleanMsg = document.createElement("p");
    cleanMsg.className = "field-hint";
    cleanMsg.textContent = "Clean working tree: no uncommitted file changes.";
    summary.append(cleanMsg);
  } else {
    const chipWrap = document.createElement("div");
    chipWrap.className = "file-chips";
    for (const file of active.changedFiles.slice(0, 24)) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn btn-ghost";
      btn.textContent = `${file.status} ${file.path}`;
      btn.addEventListener("click", () => void loadDiff(active.id, file.path));
      chipWrap.append(btn);
    }
    summary.append(chipWrap);
  }
}

async function loadDiff(workspaceId, filePath) {
  const viewer = el("diff-viewer");
  viewer.textContent = `Loading Git diff for ${filePath}...`;
  try {
    const data = await apiRequest(
      `/api/workspaces/${encodeURIComponent(workspaceId)}/diff?file=${encodeURIComponent(filePath)}`,
    );
    viewer.textContent = data.diff;
  } catch (err) {
    viewer.textContent = err instanceof Error ? err.message : "Failed to load diff.";
  }
}

function renderProviders() {
  const wrap = el("providers-list");
  wrap.replaceChildren();

  for (const prov of state.providers) {
    const card = document.createElement("article");
    card.className = "provider-card";

    const head = document.createElement("div");
    head.className = "role-header";
    const title = document.createElement("h3");
    title.textContent = prov.name;
    const status = document.createElement("span");
    status.className = prov.authenticated ? "badge-ok" : "badge-warn";
    status.textContent = prov.authenticated ? "CLI Ready" : "Host Login Needed";
    head.append(title, status);

    const desc = document.createElement("p");
    desc.className = "muted-copy";
    desc.textContent = `${prov.subscriptionNote}. ${prov.authSummary}.`;

    const cmd = document.createElement("code");
    cmd.className = "cmd-snippet";
    cmd.textContent = prov.loginCommand;

    card.append(head, desc, cmd);
    wrap.append(card);
  }
}

function renderMissions() {
  const wrap = el("missions-list");
  wrap.replaceChildren();

  if (state.missions.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted-copy";
    empty.textContent =
      "No missions dispatched yet. Pick your COO and worker models above, then send your first objective.";
    wrap.append(empty);
    return;
  }

  for (const mission of state.missions) {
    const card = document.createElement("article");
    card.className = "mission-card";

    const meta = document.createElement("div");
    meta.className = "mission-meta";
    const title = document.createElement("h3");
    title.textContent = mission.objective;
    const badge = document.createElement("span");
    badge.className = "role-badge";
    badge.textContent = `Active COO: ${mission.cooProviderId} / ${mission.cooModel}`;
    meta.append(title, badge);

    const stepsList = document.createElement("ol");
    stepsList.className = "step-list";
    for (const step of mission.steps) {
      const item = document.createElement("li");
      item.className = "step-item";
      const head = document.createElement("div");
      head.className = "step-head";
      const stepLabel = document.createElement("span");
      stepLabel.textContent = `${step.ordinal}. ${step.title}`;
      const stepModel = document.createElement("span");
      stepModel.className = "mono";
      stepModel.textContent = `${step.providerId}:${step.model} [${step.status}]`;
      head.append(stepLabel, stepModel);

      const detail = document.createElement("p");
      detail.className = "step-detail";
      detail.textContent = step.detail;
      item.append(head, detail);
      stepsList.append(item);
    }

    const switchForm = document.createElement("form");
    switchForm.className = "mid-switch-bar";
    switchForm.setAttribute("aria-label", `Switch model live for mission ${mission.id}`);

    const roleDiv = document.createElement("div");
    roleDiv.className = "mini-field";
    const roleLabel = document.createElement("label");
    roleLabel.htmlFor = `mid-role-${mission.id}`;
    roleLabel.textContent = "Mission Role";
    const roleSelect = document.createElement("select");
    roleSelect.id = `mid-role-${mission.id}`;
    for (const [val, text] of [
      ["coo", "COO"],
      ["implementer", "Implementer"],
      ["researcher", "Research"],
    ]) {
      const opt = document.createElement("option");
      opt.value = val;
      opt.textContent = text;
      roleSelect.append(opt);
    }
    roleDiv.append(roleLabel, roleSelect);

    const modelDiv = document.createElement("div");
    modelDiv.className = "mini-field";
    const modelLabel = document.createElement("label");
    modelLabel.htmlFor = `mid-model-${mission.id}`;
    modelLabel.textContent = "Switch to Model";
    const modelSelect = document.createElement("select");
    modelSelect.id = `mid-model-${mission.id}`;
    for (const prov of state.providers) {
      for (const m of prov.models) {
        const opt = document.createElement("option");
        opt.value = `${prov.id}::${m.id}`;
        opt.textContent = `${prov.name}: ${m.label}`;
        modelSelect.append(opt);
      }
    }
    modelDiv.append(modelLabel, modelSelect);

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.className = "btn btn-secondary";
    submitBtn.textContent = "Switch Model Live";

    switchForm.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const [providerId, model] = modelSelect.value.split("::");
      submitBtn.disabled = true;
      try {
        const updated = await apiRequest(
          `/api/missions/${encodeURIComponent(mission.id)}/model`,
          {
            method: "PATCH",
            body: JSON.stringify({
              role: roleSelect.value,
              providerId,
              model,
            }),
          },
        );
        state.missions = state.missions.map((item) =>
          item.id === updated.mission.id ? updated.mission : item,
        );
        state.roles[roleSelect.value] = { providerId, model };
        backdrop.pulse(roleSelect.value);
        renderRoleSelectors();
        renderMissions();
      } catch (err) {
        showError("global-error", err instanceof Error ? err.message : "Failed to switch mission model.");
      } finally {
        submitBtn.disabled = false;
      }
    });

    switchForm.append(roleDiv, modelDiv, submitBtn);
    card.append(meta, stepsList, switchForm);
    wrap.append(card);
  }
}

function connectEvents() {
  const source = new EventSource("/api/events");
  source.addEventListener("roles_updated", (ev) => {
    const data = JSON.parse(ev.data);
    state.roles = data.roles;
    renderRoleSelectors();
  });
  source.addEventListener("mission_created", (ev) => {
    const { mission } = JSON.parse(ev.data);
    if (!state.missions.some((m) => m.id === mission.id)) {
      state.missions = [mission, ...state.missions];
      renderMissions();
    }
  });
  source.addEventListener("mission_updated", (ev) => {
    const { mission } = JSON.parse(ev.data);
    state.missions = state.missions.map((m) => (m.id === mission.id ? mission : m));
    renderMissions();
  });
}

async function loadDashboardState() {
  el("pair-gate").hidden = true;
  el("main-stage").hidden = false;
  el("mobile-dock").hidden = false;
  el("global-loading").hidden = false;
  showError("global-error", "");

  try {
    const data = await apiRequest("/api/state");
    state.roles = data.roles;
    state.providers = data.providers;
    state.workspaces = data.workspaces;
    state.missions = data.missions;
    el("global-loading").hidden = true;
    renderRoleSelectors();
    renderWorkspaces();
    renderProviders();
    renderMissions();
    connectEvents();
  } catch (err) {
    el("global-loading").hidden = true;
    showError(
      "global-error",
      err instanceof Error ? err.message : "Failed to load Plure server state.",
    );
  }
}

async function tryFragmentPair() {
  const hash = window.location.hash || "";
  if (!hash.startsWith("#pair=")) return false;
  const token = decodeURIComponent(hash.slice("#pair=".length)).trim();
  if (!token) return false;
  history.replaceState(null, "", window.location.pathname + window.location.search);
  try {
    await apiRequest("/api/auth/pair", {
      method: "POST",
      body: JSON.stringify({ token, deviceLabel: "Auto Paired Browser" }),
    });
    return true;
  } catch (err) {
    showError(
      "pair-error",
      err instanceof Error ? err.message : "Automatic pairing token was rejected.",
    );
    return false;
  }
}

function bindEvents() {
  el("btn-toggle-theme").addEventListener("click", () => {
    applyTheme(state.theme === "dark" ? "light" : "dark");
  });

  el("btn-toggle-motion").addEventListener("click", () => {
    backdrop.setEnabled(!backdrop.isEnabled());
    updateMotionButton();
  });

  el("form-pair").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const tokenInput = el("pair-token");
    const deviceInput = el("pair-device");
    const token = tokenInput.value.trim();
    if (!token) {
      tokenInput.setAttribute("aria-invalid", "true");
      showError("pair-error", "Enter a server pairing code first.");
      tokenInput.focus();
      return;
    }
    tokenInput.removeAttribute("aria-invalid");
    const submit = el("btn-submit-pair");
    submit.disabled = true;
    try {
      await apiRequest("/api/auth/pair", {
        method: "POST",
        body: JSON.stringify({
          token,
          deviceLabel: deviceInput.value.trim() || "Web Device",
        }),
      });
      showError("pair-error", "");
      await loadDashboardState();
    } catch (err) {
      tokenInput.setAttribute("aria-invalid", "true");
      showError("pair-error", err instanceof Error ? err.message : "Device pairing failed.");
      tokenInput.focus();
    } finally {
      submit.disabled = false;
    }
  });

  el("pair-token").addEventListener("input", () => {
    el("pair-token").removeAttribute("aria-invalid");
    showError("pair-error", "");
  });

  for (const role of ROLES) {
    const providerSelect = el(`provider-${role}`);
    const modelSelect = el(`model-${role}`);

    providerSelect.addEventListener("change", async () => {
      const nextProv = state.providers.find((p) => p.id === providerSelect.value);
      const defaultModel = nextProv?.models[0]?.id || "default";
      const res = await apiRequest("/api/roles", {
        method: "PATCH",
        body: JSON.stringify({ role, providerId: providerSelect.value, model: defaultModel }),
      });
      state.roles = res.roles;
      backdrop.pulse(role);
      renderRoleSelectors();
    });

    modelSelect.addEventListener("change", async () => {
      const res = await apiRequest("/api/roles", {
        method: "PATCH",
        body: JSON.stringify({
          role,
          providerId: providerSelect.value,
          model: modelSelect.value,
        }),
      });
      state.roles = res.roles;
      backdrop.pulse(role);
      renderRoleSelectors();
    });
  }

  el("select-workspace").addEventListener("change", (ev) => {
    state.selectedWorkspaceId = ev.target.value;
    renderWorkspaces();
  });

  el("form-mission").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const objectiveInput = el("mission-objective");
    const objective = objectiveInput.value.trim();
    if (!state.selectedWorkspaceId) {
      showError("mission-error", "Register and select an active Git repository first.");
      el("workspace-path").focus();
      return;
    }
    if (!objective) {
      objectiveInput.setAttribute("aria-invalid", "true");
      showError("mission-error", "Enter a coding objective for the COO first.");
      objectiveInput.focus();
      return;
    }
    objectiveInput.removeAttribute("aria-invalid");
    showError("mission-error", "");

    const modeRadio = document.querySelector('input[name="executionMode"]:checked');
    const executionMode = modeRadio ? modeRadio.value : "plan";
    const btn = el("btn-launch-mission");
    btn.disabled = true;
    btn.textContent = "Orchestrating...";
    try {
      const created = await apiRequest("/api/missions", {
        method: "POST",
        body: JSON.stringify({
          workspaceId: state.selectedWorkspaceId,
          objective,
          executionMode,
        }),
      });
      objectiveInput.value = "";
      if (!state.missions.some((m) => m.id === created.mission.id)) {
        state.missions = [created.mission, ...state.missions];
      }
      backdrop.pulse("coo");
      renderMissions();
    } catch (err) {
      showError(
        "mission-error",
        err instanceof Error ? err.message : "Failed to dispatch COO mission.",
      );
    } finally {
      btn.disabled = false;
      btn.textContent = "Dispatch Mission to COO";
    }
  });

  el("mission-objective").addEventListener("input", () => {
    el("mission-objective").removeAttribute("aria-invalid");
    showError("mission-error", "");
  });

  el("form-workspace").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const pathInput = el("workspace-path");
    const labelInput = el("workspace-label");
    const rawPath = pathInput.value.trim();
    if (!rawPath) {
      pathInput.setAttribute("aria-invalid", "true");
      showError("workspace-error", "Enter a Git repository directory path on the host machine.");
      pathInput.focus();
      return;
    }
    pathInput.removeAttribute("aria-invalid");
    try {
      const created = await apiRequest("/api/workspaces", {
        method: "POST",
        body: JSON.stringify({ path: rawPath, label: labelInput.value.trim() }),
      });
      showError("workspace-error", "");
      pathInput.value = "";
      labelInput.value = "";
      const existingIdx = state.workspaces.findIndex((w) => w.id === created.workspace.id);
      if (existingIdx >= 0) {
        state.workspaces[existingIdx] = created.workspace;
      } else {
        state.workspaces = [created.workspace, ...state.workspaces];
      }
      state.selectedWorkspaceId = created.workspace.id;
      renderWorkspaces();
    } catch (err) {
      pathInput.setAttribute("aria-invalid", "true");
      showError("workspace-error", err instanceof Error ? err.message : "Invalid repository path.");
      pathInput.focus();
    }
  });

  const pairDialog = el("dialog-mobile-pair");
  el("btn-open-pair-modal").addEventListener("click", () => {
    pairDialog.showModal();
  });
  el("btn-close-pair-modal").addEventListener("click", () => {
    pairDialog.close();
  });

  el("btn-generate-invite").addEventListener("click", async () => {
    const out = el("invite-output");
    try {
      const invite = await apiRequest("/api/auth/invite", {
        method: "POST",
        body: JSON.stringify({ label: "Phone App" }),
      });
      out.hidden = false;
      out.replaceChildren();
      const codeP = document.createElement("p");
      codeP.textContent = `Single-use pairing code: ${invite.code}`;
      out.append(codeP);
      if (invite.lanUrls && invite.lanUrls.length > 0) {
        for (const url of invite.lanUrls) {
          const codeEl = document.createElement("code");
          codeEl.className = "cmd-snippet";
          codeEl.textContent = url;
          out.append(codeEl);
        }
      } else {
        const note = document.createElement("p");
        note.className = "field-hint";
        note.textContent =
          "Start the server with --lan for local Wi-Fi, or open your PC's Tailscale URL with the code above.";
        out.append(note);
      }
    } catch (err) {
      out.hidden = false;
      out.textContent =
        err instanceof Error ? err.message : "Pair this desktop browser first before generating a phone invite.";
    }
  });

  document.body.setAttribute("data-mobile-view", "orchestrate");
  for (const btn of document.querySelectorAll("[data-mobile-tab]")) {
    btn.addEventListener("click", () => {
      const tab = btn.getAttribute("data-mobile-tab");
      document.body.setAttribute("data-mobile-view", tab);
      for (const peer of document.querySelectorAll("[data-mobile-tab]")) {
        peer.classList.toggle("is-active", peer === btn);
      }
    });
  }
}

async function bootstrap() {
  applyTheme(state.theme);
  updateMotionButton();
  bindEvents();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("/sw.js").catch(() => undefined);
  }

  window.addEventListener("hashchange", async () => {
    const ok = await tryFragmentPair();
    if (ok) await loadDashboardState();
  });

  const pairedViaHash = await tryFragmentPair();
  if (pairedViaHash) {
    await loadDashboardState();
    return;
  }

  const status = await apiRequest("/api/auth/status").catch(() => ({ authenticated: false }));
  if (status.authenticated) {
    await loadDashboardState();
  } else {
    el("pair-gate").hidden = false;
    el("main-stage").hidden = true;
    el("mobile-dock").hidden = true;
  }
}

void bootstrap();
