# Plure

Plure is a standalone, clean-room multi-AI repository orchestration web app and installable Progressive Web App (PWA) built from scratch with zero external npm dependencies:

- **COO Coordinator:** Devin CLI defaulting to **Kimi K3.1 Pro Max** (`kimi-k3.1-pro-max`), switchable live at any time.
- **Code Implementer:** Claude Code (`claude-sonnet-4-6`, `claude-opus-4-6`, `claude-haiku-4-5`).
- **Research & Review:** Antigravity (`gemini-2.5-pro`, `hydrogen-medium`, `gemini-2.5-flash`).
- **Live Model Switchboard:** Switch providers and models both before dispatching and mid-mission, synchronized in real time over Server-Sent Events (SSE).
- **Git Repository & Diff Inspector:** Monitor active branches, modified files, and live `git diff` output across registered host repositories.
- **Desktop, iOS & Android PWA Access:** Installable directly to iOS (Safari: Share > Add to Home Screen) and Android (Chrome: Install App) as a full-screen app, backed by single-use `HttpOnly` pairing codes so subscription credentials never leave your host PC.

## Requirements

- Node.js 24 LTS or Node.js 26+ (uses built-in `node:http`, `node:sqlite`, and `node:test`)
- Git

## Quick Start

```powershell
cd D:\reverse-engineering\workspace\plure
npm test
npm run build
npm start -- --online
```

`--online` automatically starts a built-in **Cloudflare HTTPS Tunnel** (`*.trycloudflare.com`) and prints a single-use phone pairing URL that works over 4G/5G from anywhere without Tailscale or port forwarding. You can also start and stop Cloudflare Tunnel live from **Connect Phone** inside the dashboard.

## Host CLI Subscriptions

Authenticate once on your host machine terminal (credentials stay on your computer):

- **Devin CLI (Kimi COO):** `devin auth login`
- **Claude Code:** `claude auth login`
- **Antigravity:** `agy login`
