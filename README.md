<p align="center">
  <img src="assets/icon.png" alt="Kanna" width="80" />
</p>

<h1 align="center">Kanna</h1>

<p align="center">
  <strong>A beautiful web UI for the Claude Code & Codex CLIs</strong>
</p>

<p align="center">
  <em>Community fork of <a href="https://github.com/jakemor/kanna">jakemor/kanna</a> — kept in sync with upstream and extended with subscription-billing PTY mode, OAuth token pooling, multi-provider chat (Claude + Codex + OpenRouter), subagent orchestration, custom MCP servers, a workflow status panel, durable tool-approval protocol, in-app self-update, and more.</em>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cuongtran001/kanna"><img src="https://img.shields.io/npm/v/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@cuongtran001/kanna"><img src="https://img.shields.io/npm/dm/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="npm downloads" /></a>
  <a href="https://github.com/cuongtranba/kanna/actions/workflows/release-please.yml"><img src="https://github.com/cuongtranba/kanna/actions/workflows/release-please.yml/badge.svg?branch=main" alt="Release Please" /></a>
  <a href="https://github.com/cuongtranba/kanna/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="license" /></a>
</p>

<p align="center">
  📖 <strong>Docs:</strong> <a href="https://kanna-wiki.lowbit.link">kanna-wiki.lowbit.link</a>
</p>

<br />

<p align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/screenshot.png" />
    <source media="(prefers-color-scheme: light)" srcset="assets/screenshot-light.png" />
    <img src="assets/screenshot.png" alt="Kanna screenshot" width="800" />
  </picture>
</p>

<br />

## About this fork

Kanna started life as [jakemor/kanna](https://github.com/jakemor/kanna) — a clean web UI for the Claude Code CLI. This fork (`@cuongtran001/kanna`) tracks upstream and layers on features needed for heavier day-to-day use, multi-account billing, and self-hosting.

**Headline additions vs. upstream:**

- **Subscription-billing PTY driver** (`KANNA_CLAUDE_DRIVER=pty`) — runs the `claude` CLI under a pseudo-terminal so Pro/Max plans are charged instead of API rates. Parses the on-disk transcript JSONL as the sole event source, with HarnessEvent parity with the SDK driver, a cached per-spawn smoke-test gate, and failure-mode parity.
- **OAuth token pool** — register multiple Claude OAuth tokens; Kanna rotates across them per chat with automatic fallover on rate-limit and an explicit disabled state.
- **Multi-provider chat** — switch between Claude, Codex (OpenAI), and OpenRouter from the composer with per-provider model + reasoning-effort controls and Codex fast mode. OpenRouter populates its model picker live from the public catalog (tool-capable models).
- **Subagent orchestration** — first-class subagent CRUD, `@agent/` mentions, parallel runs, live activity labels, MCP progress notifications, and `mcp__kanna__delegate_subagent` so the main agent itself can delegate — including **keep-alive multi-turn** sessions (`send_subagent_message` / `close_subagent`) and **background** runs that report back as a fresh turn.
- **Custom MCP servers** — register your own `stdio` / `http` / `sse` / `ws` MCP servers from Settings (with OAuth 2.1 for network transports); they merge into both drivers and their tools surface as `mcp__<name>__<tool>`.
- **Workflow status panel** — read-only per-chat panel surfacing Claude Code's native Workflow tool runs (live status, drill-in progress, token totals) via disk-watch, under both drivers.
- **Agent self-scheduled wake** — `mcp__kanna__schedule_wakeup` lets the agent re-enter the chat to harvest long-running background work, with a runaway-loop cap.
- **Durable tool-approval protocol** (`KANNA_MCP_TOOL_CALLBACKS=1`) — pending `AskUserQuestion` / `ExitPlanMode` / built-in shims survive server restart and replay to the client on reconnect.
- **Cloudflare `expose_port` MCP tool** — agent-callable port exposure with always-ask or auto-expose modes, replacing bash-output sniffing.
- **In-app self-update** — one-click pull/rebuild/reload with a host-agnostic supervisor (works under pm2, systemd, docker, plain shell) or direct pm2 reload; install any prior release straight from the changelog UI.
- **Git worktree isolation** per chat, **bulk import** of existing `~/.claude/projects/` sessions, **proactive context compaction**, **per-turn token cost**, **local skills & slash commands** in the composer `/` picker, **password gate** for HTTP/WS/API, **PWA / mobile layout**, **mermaid rendering** in transcripts, **standalone HTML transcript export**, and **customizable keybindings**.

See the full inventory in [Features](#features) below.

## Quickstart

```bash
bun install -g @cuongtran001/kanna
```

If Bun isn't installed, install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Then run from any project directory:

```bash
kanna
```

That's it. Kanna opens in your browser at [`localhost:3210`](http://localhost:3210).

## Features

**Providers & models**

- **Multi-provider support** — switch between Claude, Codex (OpenAI), and OpenRouter from the chat input, with per-provider model selection, reasoning-effort controls, and Codex fast mode
- **OpenRouter** — set an OpenRouter API key in Settings; the model picker populates live from OpenRouter's catalog (tool-capable models), routed through its Anthropic-compatible endpoint
- **OAuth token pool** — register multiple Claude OAuth tokens; Kanna rotates across them per chat
- **Subscription-billing PTY driver** — optional `KANNA_CLAUDE_DRIVER=pty` runs the `claude` CLI under a pseudo-terminal so Pro/Max subscription billing is preserved instead of API rates
- **Custom MCP servers** — register `stdio` / `http` / `sse` / `ws` MCP servers from Settings (OAuth 2.1 for network transports); merged into both drivers

**Chat & transcript**

- **Rich transcript rendering** — hydrated tool calls, collapsible tool groups, plan-mode dialogs, and interactive prompts with full result display
- **Inline diff viewer** — file and commit diffs rendered directly in the transcript
- **Embedded terminal** — per-project xterm terminal in a resizable side panel (macOS/Linux)
- **File & image uploads** — drag-and-drop attachments into the composer
- **Slash commands & @-mentions** — in-composer pickers for slash commands (including local Claude Code skills/commands), file mentions, and subagents
- **Plan mode** — review and approve agent plans before execution
- **Subagent orchestration** — run and track parallel subagents within a turn, plus keep-alive multi-turn sessions and non-blocking background runs that report back as a fresh turn
- **Workflow status panel** — read-only per-chat view of Claude Code's native Workflow tool runs with live status and drill-in progress
- **Agent self-scheduled wake** — the agent can re-enter the chat to harvest long-running background work (`schedule_wakeup`), with a runaway-loop cap
- **Background tasks** — long-running tasks tracked out-of-band with a status indicator
- **Per-turn token cost** — token usage and estimated USD cost shown inline per turn
- **Auto-continue** — optionally continue a turn automatically when the agent stops short
- **Proactive compaction** — context-window meter with automatic transcript compaction before limits are hit

**Projects & sessions**

- **Project-first sidebar** — chats grouped under projects, with live status indicators (idle, running, waiting, failed)
- **Drag-and-drop project ordering** — reorder project groups in the sidebar with persistent ordering
- **Local project discovery** — auto-discovers projects from both Claude and Codex local history
- **Bulk import Claude Code sessions** — one-click import of existing `~/.claude/projects/` sessions with full transcript and seamless resume via the Claude Agent SDK
- **Git worktree isolation** — run a chat in an isolated worktree without disturbing your working tree
- **Session resumption** — resume agent sessions with full context preservation
- **Auto-generated titles** — chat titles generated in the background via Claude Haiku
- **Quick responses** — lightweight structured queries (e.g. title generation) via Haiku with automatic Codex fallback

**Persistence & realtime**

- **Persistent local history** — refresh-safe routes backed by append-only JSONL event logs and compacted snapshots
- **WebSocket-driven** — real-time subscription model with reactive state broadcasting
- **Standalone transcript export** — export a chat as a self-contained HTML viewer

**Access & notifications**

- **Password protection** — optional launch password gating the app, WebSocket, and API routes
- **Public share link** — `--share` creates a temporary `trycloudflare.com` URL with a terminal QR code
- **Cloudflare tunnel via `expose_port` tool** — opt-in; the agent proactively calls the Kanna `expose_port` MCP tool with a port. In `always-ask` mode Kanna shows an inline "expose via Cloudflare" card for you to accept; in `auto-expose` mode `cloudflared tunnel --url` spawns immediately. Both modes are gated by the Cloudflare Tunnel setting
- **Web push & sound notifications** — browser push and sound alerts when a chat needs attention
- **Customizable keybindings** — user-editable keyboard shortcuts
- **In-app self-update** — one-click update that pulls, rebuilds, and hot-reloads (host-agnostic supervisor or pm2)
- **Mobile-friendly** — responsive layout, installable as a standalone PWA

## Architecture

```mermaid
flowchart LR
    Browser["Browser<br/>React + Zustand"]

    subgraph Server["Bun Server (src/server/**)"]
        direction TB
        WS["WSRouter<br/>subscriptions + commands"]
        Auth["Auth gate"]
        Agent["AgentCoordinator<br/>multi-provider turns"]
        ES["EventStore<br/>append-only JSONL + snapshots"]
        RM["ReadModels<br/>derived views"]
        Diff["DiffStore"]
        Term["TerminalManager"]
        Up["Uploads"]
        Disc["Discovery"]
        Push["Push"]
        Tun["Share / Tunnel"]
        Upd["UpdateManager"]

        subgraph Adapters["*.adapter.ts (IO seal exempt)"]
            direction LR
            FsA["fs / chokidar"]
            DbA["bun:sqlite / pg"]
            SpA["Bun.spawn / child_process"]
            HtA["node:http / fetch"]
            PtyA["Bun.Terminal (PTY)"]
        end

        WS --> Agent
        WS --> ES
        WS --> RM
        Agent --> ES
        Agent -.spawn.-> SpA
        Agent -.spawn.-> PtyA
        ES -.fs.-> FsA
        Diff -.fs+spawn.-> SpA
        Diff -.fs.-> FsA
        Term -.pty.-> PtyA
        Up -.fs.-> FsA
        Disc -.fs.-> FsA
        Tun -.spawn+http.-> SpA
        Tun -.http.-> HtA
        Upd -.spawn.-> SpA
    end

    subgraph Shared["src/shared/** (pure)"]
        Proto["protocol types"]
        Types["domain types"]
    end

    subgraph External["External processes"]
        CC["Claude Agent SDK / claude CLI (PTY)"]
        CX["Codex App Server"]
        FS["Local FS<br/>~/.kanna/data/, project dirs"]
    end

    Browser <-->|WebSocket| WS
    Browser -.types.-> Shared
    Server -.types.-> Shared

    SpA --> CC
    SpA --> CX
    PtyA --> CC
    FsA --> FS
```

**Layer rules (lint-enforced, see [CLAUDE.md](./CLAUDE.md#side-effect-lint-ports-and-adapters-seal)):**

- `src/shared/**` + `src/client/**` — pure. ESLint `no-restricted-imports` errors on `node:fs`, `bun:sqlite`, `node:child_process`, `node:http`, `Bun.spawn`, `Bun.file`, `Bun.serve`, …
- `src/server/**` production — also sealed at `error`. Side-effect call sites only allowed inside files matching `**/*.adapter.ts` (or the legacy `src/server/adapters/**` dir).
- Mixed-concern modules extract their IO into a sibling `*-io.adapter.ts` and import through it.

**Key patterns:** Event sourcing for all state mutations. CQRS with separate write (event log) and read (derived snapshots) paths. Reactive broadcasting — subscribers get pushed fresh snapshots on every state change. Multi-provider agent coordination with tool gating for user-approval flows. Provider-agnostic transcript hydration for unified rendering.

### Workflow: adding code that touches IO

```mermaid
flowchart TD
    Start(["You need fs / spawn / http / DB / Bun globals"]) --> Layer{"Which layer?"}
    Layer -->|src/shared or src/client| Reject["ESLint errors at CI"]
    Reject --> Move["Move the module to src/server/**<br/>or inject through a typed parameter"]
    Move --> Server
    Layer -->|src/server| Server{"File responsibility?"}
    Server -->|leaf IO wrapper| RenameAdapter["Name it foo.adapter.ts<br/>(exempt from seal)"]
    Server -->|mixed domain + IO| SiblingAdapter["Extract calls into foo-io.adapter.ts<br/>keep domain logic in foo.ts<br/>import helpers from the adapter"]
    Server -->|domain only| Port["Take a typed port parameter<br/>provided by caller's adapter"]
    RenameAdapter --> Lint["bun run lint"]
    SiblingAdapter --> Lint
    Port --> Lint
    Lint --> CI(["CI: lint + tests + build"])
```

For the longer story (90 → 0 burndown, ratchet pipeline retired in PR #303) see the **Side-Effect Lint** section of `CLAUDE.md`.

## Requirements

- [Bun](https://bun.sh) v1.3.11+
- A working [Claude Code](https://docs.anthropic.com/en/docs/claude-code) environment
- _(Optional)_ [Codex CLI](https://github.com/openai/codex) for Codex provider support

Embedded terminal support uses Bun's native PTY APIs and currently works on macOS/Linux.

## Install

Install Kanna globally:

```bash
bun install -g @cuongtran001/kanna
```

If Bun isn't installed, install it first:

```bash
curl -fsSL https://bun.sh/install | bash
```

Or clone and build from source:

```bash
git clone https://github.com/cuongtranba/kanna.git
cd kanna
bun install
bun run build
```

## Usage

```bash
kanna                  # start with defaults (localhost only)
kanna --port 4000      # custom port
kanna --strict-port    # fail instead of trying another port
kanna --no-open        # don't open browser
kanna --password <secret>      # require a password before loading the app
kanna --share                # create a public quick tunnel + terminal QR
kanna --cloudflared <token>  # run a named Cloudflare tunnel from a token
```

Default URL: `http://localhost:3210`

### Network access (Tailscale / LAN)

By default Kanna binds to `127.0.0.1` (localhost only). Use `--host` to bind a specific interface, or `--remote` as a shorthand for `0.0.0.0`:

```bash
kanna --remote                     # bind all interfaces — browser opens localhost:3210
kanna --host dev-box               # bind to a specific hostname — browser opens http://dev-box:3210
kanna --host 192.168.1.x           # bind to a specific LAN IP
kanna --host 100.64.x.x            # bind to a specific Tailscale IP
```

When `--host <hostname>` is given, the browser opens `http://<hostname>:3210` automatically. Other machines on your network can connect to the same URL:

### Password protection

Use `--password` to require a launch password before the app or websocket can connect:

```bash
kanna --password my-secret
bun run dev --password my-secret
```

Kanna verifies the password once, then sets a browser-session cookie. The password itself is not stored in the browser.
When password protection is enabled, the backend requires authentication for API routes and `/ws`. The SPA shell still loads, `/health` remains public for restart detection, and the same in-app password screen is used in both dev and production.

### Public share link

Use `--share` to create a temporary public `trycloudflare.com` URL and print a terminal QR code:

```bash
kanna --share
kanna --share --port 4000
kanna --cloudflared <token>
```

`--share` is incompatible with `--host` and `--remote`. It does not open a browser automatically.

Without a token, it prints:

```text
QR Code:
...

Public URL:
https://<random>.trycloudflare.com

Local URL:
http://localhost:3210
```

With `--cloudflared <token>`, Kanna runs `cloudflared tunnel run --token <token> --url <local-url>`.
If Kanna can detect the public hostname from cloudflared output, it prints the same QR/public/local block.
If not, it keeps the tunnel running, warns that no public hostname was detected, and prints the local URL so you can use the hostname already configured for that tunnel in Cloudflare.

### Auto-expose detected ports

When the agent runs a Bash command in a chat (`bun run dev`, `go run`, `uvicorn`, etc.), Kanna can detect any listening port from the command's stdout and offer to expose it through a Cloudflare quick tunnel without leaving the chat.

Enable from **Settings → Cloudflare Tunnel**:

- **Toggle** — opt-in (off by default)
- **Mode** — `Always ask` (one card per detected port; click Expose to spawn) or `Auto-expose` (spawn immediately on detection)
- **`cloudflared` path** — defaults to `cloudflared` on `$PATH`

Each detected port shows up inline in the transcript. Click **Expose**, watch the spinner until cloudflared returns the `*.trycloudflare.com` URL, then click **Stop** when done. Tunnels are also stopped automatically when the chat closes or the server restarts.

Requires the `cloudflared` binary installed locally — `brew install cloudflared` on macOS, or see [Cloudflare's downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).

## Development

```bash
bun run dev
```

The same `--remote` and `--host` flags can be used with `bun run dev` for remote development.
`--share` is also supported in dev mode and exposes the Vite client URL publicly:

```bash
bun run dev --share
bun run dev --cloudflared <token>
bun run dev --port 3333 --share
```

In dev, `--port` sets the Vite client port and the backend runs on `port + 1`, so `bun run dev --port 3333 --share` publishes `http://localhost:3333`.
`--share` remains incompatible with `--host` and `--remote`.
Use `bun run dev --port 4000` to run the Vite client on `4000` and the backend on `4001`.

Or run client and server separately:

```bash
bun run dev:client   # http://localhost:5174
bun run dev:server   # http://localhost:5175
```

## Scripts

| Command              | Description                          |
| -------------------- | ------------------------------------ |
| `bun run build`      | Build client + standalone export viewer |
| `bun run check`      | Typecheck, lint, and build           |
| `bun run lint`       | ESLint over `src/` (zero-warning gate) |
| `bun run dev`        | Run client + server together         |
| `bun run dev:client` | Vite dev server only (`:5174`)       |
| `bun run dev:server` | Bun backend only (`:5175`)           |
| `bun run start`      | Start production server              |
| `bun test`           | Run the test suite                   |

## Project Structure

Abridged — the actual tree has more modules, each with co-located `*.test.ts`:

```
src/
├── client/          React UI layer
│   ├── app/         App router, pages, central state hook, socket client
│   ├── components/  chat-ui, messages, settings, ui primitives, modals
│   ├── hooks/       mobile/standalone detection, theme, mention/slash suggestions
│   ├── stores/      Zustand stores (chat input, preferences, terminal, tasks…)
│   └── lib/         formatters, path utils, transcript parsing, keybindings
├── server/          Bun backend
│   ├── cli.ts · cli-runtime.ts   CLI entry, flag parsing, supervisor
│   ├── server.ts                 HTTP/WS server + static serving
│   ├── auth.ts                   password gate for HTTP/WS/API
│   ├── ws-router.ts              WebSocket routing & subscriptions
│   ├── agent.ts                  AgentCoordinator (multi-provider turns)
│   ├── codex-app-server.ts       Codex App Server JSON-RPC client
│   ├── claude-pty/               PTY driver (subscription billing)
│   ├── oauth-pool/               Claude OAuth token rotation
│   ├── provider-catalog.ts       provider/model/effort normalization
│   ├── openrouter-models.ts      live OpenRouter catalog (tool-capable models)
│   ├── quick-response.ts         structured queries w/ provider fallback
│   ├── event-store.ts            JSONL persistence, replay & compaction
│   ├── read-models.ts            derived view models
│   ├── events.ts                 event type definitions
│   ├── discovery.ts              auto-discover Claude/Codex projects
│   ├── local-catalog.ts          local Claude skills/slash-command discovery
│   ├── claude-session-importer.ts  bulk import existing sessions
│   ├── diff-store.ts             per-chat diff hydration
│   ├── terminal-manager.ts       embedded-terminal PTY sessions
│   ├── uploads.ts                attachment intake
│   ├── subagent-orchestrator.ts  parallel + keep-alive + background subagent runs
│   ├── workflow-registry.ts      workflow status panel (disk-watch read-model)
│   ├── background-tasks.ts       out-of-band task tracking
│   ├── worktree-store.ts         git worktree isolation
│   ├── push/                     web-push notifications
│   ├── share.ts · cloudflare-tunnel/  trycloudflare / expose_port tunnels
│   ├── update-manager.ts · update-strategy.ts  self-update
│   ├── kanna-mcp.ts              Kanna MCP tools (built-in shims)
│   ├── mcp-validator.ts · mcp-oauth.adapter.ts  custom MCP connect-test + OAuth
│   └── keybindings.ts            persisted keybindings
└── shared/          Shared between client & server
    ├── types.ts     core domain types, provider catalog, transcript entries
    ├── tools.ts     tool-call normalization & hydration
    ├── protocol.ts  WebSocket wire envelopes
    ├── ports.ts     default ports & dev-mode offsets
    ├── share.ts     share/tunnel shared types
    ├── token-pricing.ts  per-turn token cost (USD)
    └── branding.ts  app name & data-directory paths
```

## Data Storage

All state is stored locally at `~/.kanna/data/`:

| File             | Purpose                                   |
| ---------------- | ----------------------------------------- |
| `projects.jsonl` | Project open/remove events                |
| `chats.jsonl`    | Chat create/rename/delete events          |
| `messages.jsonl` | Transcript message entries                |
| `turns.jsonl`    | Agent turn start/finish/cancel events     |
| `snapshot.json`  | Compacted state snapshot for fast startup |

Event logs are append-only JSONL. On startup, Kanna replays the log tail after the last snapshot, then compacts if the logs exceed 2 MB.

## Self-hosting on macOS (pm2 + Cloudflare tunnel)

Run Kanna as a background service on macOS under [pm2](https://pm2.keymetrics.io/), exposed through a named Cloudflare tunnel. The in-app **Update** button then pulls the latest commit, rebuilds, and hot-reloads the pm2 process — no terminal round-trip needed.

### 1. Link the repo as the global install

`bun link` makes the global `kanna` binary resolve to your checkout:

```bash
cd ~/path/to/kanna
bun install
bun run build
bun link           # registers @cuongtran001/kanna → repo
```

After this, `~/.bun/install/global/node_modules/@cuongtran001/kanna` is a symlink to your repo.

### 2. Create a named Cloudflare tunnel

In the [Cloudflare Zero Trust dashboard](https://one.dash.cloudflare.com/) → **Networks → Tunnels → Create tunnel** (type: **Cloudflared**):

1. Name the tunnel (e.g. `kanna`) and copy the **connector token** Cloudflare shows you. You will paste it as `KANNA_CLOUDFLARED_TOKEN` in the next step.
2. Add a **public hostname** route: pick your subdomain (e.g. `kanna.example.com`) and point service to `HTTP` → `localhost:5174` (or whatever `--port` you plan to run). Kanna binds `127.0.0.1` automatically when `--cloudflared` is set, so the tunnel is the only ingress.
3. Save. The hostname's TLS is terminated at Cloudflare's edge.

### 3. Write `scripts/pm2.env` (untracked secrets)

`scripts/deploy.sh` reads this file and passes the values to kanna as `--cloudflared <TOKEN> --password <PW>`. Without it, deploy launches kanna with no token and no password — kanna will then run as plain HTTP on localhost, **`trustProxy` will not auto-enable**, and every `/auth/login` POST through the tunnel will return **403** because the CSRF origin check compares the browser's `https://` Origin against the server's `http://` `req.url`.

Create `scripts/pm2.env` (gitignored) with at least:

```env
KANNA_CLOUDFLARED_TOKEN=<paste the connector token from step 2>
KANNA_PASSWORD=<a long random password>
# Optional: pass through to spawned Claude Code agents
# CLAUDE_CODE_OAUTH_TOKEN=sk-ant-oat01-...
```

Generate a strong password with `openssl rand -base64 24`.

### 4. (Migrating from launchd) Unload the old agent

If you previously ran Kanna under launchd, unload it once so pm2 can take over:

```bash
launchctl bootout gui/$(id -u)/io.silentium.kanna || true
```

### 5. First deploy

`scripts/deploy.sh` installs pm2 if missing, renders `scripts/pm2.config.cjs` from the template (via `envsubst` from `brew install gettext`), and starts the pm2 process:

```bash
./scripts/deploy.sh
pm2 list               # kanna should be "online"
pm2 logs kanna --lines 50
```

`pm2 save` persists the running process list. To resurrect after a reboot, run `pm2 startup` once (pm2 prints the exact command) and then `pm2 save` again.

The pm2 config sets `KANNA_RELOADER=pm2` and `KANNA_REPO_DIR=<repo>` so the in-app Update button triggers the pm2 reload pipeline (see next section). Override the pm2 process name with `KANNA_PM2_PROCESS_NAME` before running `./scripts/deploy.sh` if you need to run multiple instances.

### 6. Redeploy / update

Two ways to ship a new build:

**a. From the UI (fastest).** Click **Update** in the running app. The server runs `git pull --ff-only` → conditional `bun install` → `bun run build` → `pm2.reload` internally, and the UI reconnects to the fresh build. If any step fails, the UI shows a red banner with the stderr tail and the old build keeps serving.

**b. From the terminal.** Useful for non-Kanna deploys (e.g., pm2 config edits) or when the UI is unreachable:

```bash
git pull
./scripts/deploy.sh
```

### 7. Troubleshooting: 403 on login

If the login screen rejects the correct password with **403** behind a Cloudflare (or any HTTPS-terminating) tunnel, the server is running without `trustProxy` enabled. The CSRF origin check then compares the browser's `https://kanna.example.com` `Origin` against the local `http://127.0.0.1:<port>` `req.url` and rejects them as mismatched. Two ways to enable it:

- **Recommended.** Pass `--cloudflared <TOKEN>` (or `--share`) on the kanna command line. Both flags auto-enable `trustProxy` and bind to `127.0.0.1`. With `scripts/pm2.env` populated, `scripts/deploy.sh` does this for you — verify with `pm2 logs kanna --lines 20` that the startup line includes `--cloudflared`.
- **Running cloudflared separately?** Use `--cloudflared` on kanna anyway and let kanna spawn the tunnel; the standalone `cloudflared` daemon does not set `trustProxy` for you. (There is no standalone `--trust-proxy` CLI flag today.)

Other things to check if the 403 persists:

- Cloudflare tunnel **public hostname** points to `http://localhost:<KANNA_PORT>`, not `https://` — kanna terminates plain HTTP locally.
- The public hostname's **TLS mode** is `Full` or `Flexible` (Cloudflare → Origin is HTTP), not `Full (strict)` against a self-signed origin.
- No `Access` policy in front of the hostname is stripping or rewriting the `Origin` header.

### 8. Update strategies

The update mechanism is abstracted behind `UpdateChecker` + `UpdateReloader` interfaces in `src/server/update-strategy.ts`, selected at startup by `KANNA_RELOADER`:

| `KANNA_RELOADER` | Check | Reload | Notes |
|---|---|---|---|
| unset / `supervisor` | npm registry for `@cuongtran001/kanna` | `<pm> install -g @cuongtran001/kanna@latest`, exit 76, supervisor respawns | Default. End-user path. `<pm>` auto-detected: `bun`/`npm`/`pnpm`/`yarn`. Override via `KANNA_UPDATE_COMMAND`. |
| `pm2` | `git fetch` + `HEAD` vs `origin/main` | `git pull --ff-only` → cond. `bun install` → `bun run build` → `pm2 reload` | Dev/self-host path. Requires `KANNA_REPO_DIR`. |

**Host-agnostic supervisor mode.** When `KANNA_RELOADER` is unset (default), the in-app Update button works under any process host (pm2, systemd, docker, screen, plain shell) — the internal supervisor catches the child's exit-76 and respawns. The package manager used to install the new version is auto-detected from the running binary path:

- `~/.bun/bin/kanna` → `bun install -g`
- `~/.local/share/pnpm/kanna` (or any `pnpm/` path) → `pnpm add -g`
- `~/.yarn/bin/kanna` (or any `.yarn/` path) → `yarn global add`
- anything else (e.g. `/usr/local/bin/kanna`, `~/.npm-global/bin/kanna`) → `npm install -g`

If the detected manager is not on `PATH`, kanna falls back through `bun → npm → pnpm → yarn`. To override the install command entirely — useful for custom installers, monorepo wrappers, docker pulls, ansible, etc. — set `KANNA_UPDATE_COMMAND`. Placeholders `{package}` and `{version}` are substituted; the result is executed via `sh -c`.

```bash
# Force npm regardless of detection
KANNA_UPDATE_COMMAND="npm install -g {package}@{version}" pm2 start kanna
# Custom: chain pre-install hook
KANNA_UPDATE_COMMAND="my-deploy-hook && npm install -g {package}@{version}" kanna
```

To add another reload mechanism (e.g., docker, systemd) at the strategy layer, implement `UpdateChecker` + `UpdateReloader` and branch inside `createUpdateStrategy`; no changes to `UpdateManager`, `server.ts`, or any client code are needed.

## Star History

<a href="https://www.star-history.com/?repos=cuongtranba%2Fkanna&type=date&legend=top-left">
 <picture>
   <source media="(prefers-color-scheme: dark)" srcset="https://api.star-history.com/image?repos=cuongtranba/kanna&type=date&theme=dark&legend=top-left" />
   <source media="(prefers-color-scheme: light)" srcset="https://api.star-history.com/image?repos=cuongtranba/kanna&type=date&legend=top-left" />
   <img alt="Star History Chart" src="https://api.star-history.com/image?repos=cuongtranba/kanna&type=date&legend=top-left" />
 </picture>
</a>

## Contributing

Contributions are welcome! Feel free to open PRs

## License

[MIT](LICENSE)
