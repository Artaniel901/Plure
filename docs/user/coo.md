# COO orchestration

The COO dashboard prepares a reviewed T3 draft for repository work. The COO can delegate bounded implementation, research, review, and test tasks to other installed agents through T3 Code. It does not create a separate task runner or store provider credentials in the browser.

## Set up providers

Open **Settings → Providers** on the environment that owns the project. Install and sign in to each agent there before selecting it in the dashboard.

- **COO:** add Devin from the ACP Registry, or choose **Local ACP command** and use `devin` with the argument `acp`. Authenticate with `devin auth login`. Select Kimi K3.1 Pro Max when your Devin account and model catalog offer it. Otherwise, choose an available model; the dashboard shows the actual selection.
- **Implementation:** install Claude Code and run `claude auth login`.
- **Research and review:** enable Antigravity, install its runtime, and complete Google sign-in. See [Antigravity](./providers-antigravity.md).

Model availability and subscription limits remain controlled by each provider. T3 Code does not resell tokens or bypass those limits.

## Start a COO thread

Open **COO** from the sidebar or the command palette. Choose a repository, the COO and worker models, and enter the outcome you want. Select **Open COO draft**.

The generated prompt names the worker provider instances and models. Read it before sending. Nothing is sent automatically. After work starts, use the normal thread view to inspect delegated tasks, answer approvals, review diffs, and change the active model with the existing model picker.

For parallel edits, the COO is instructed to use separate worktrees. Research and review can use the shared checkout. Existing T3 permission modes still apply.

## Use it from a phone

Run `t3 up` on the machine that owns the project, then choose T3 Connect or local-network access. Sign in on the phone and open the same environment. You can also use the T3 Code mobile apps for the resulting threads.

The host machine must stay running and reachable. Pair each device with its own link, keep device approval enabled when appropriate, and never publish an unauthenticated server. See [Remote access](./remote-access.md).
