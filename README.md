<p align="center">
  <img src="assets/icon.png" alt="Kanna" width="80" />
</p>

<h1 align="center">Kanna</h1>

<p align="center">
  <strong>A beautiful web UI for the Claude Code & Codex CLIs</strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@cuongtran001/kanna"><img src="https://img.shields.io/npm/v/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="npm version" /></a>
  <a href="https://www.npmjs.com/package/@cuongtran001/kanna"><img src="https://img.shields.io/npm/dm/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="npm downloads" /></a>
  <a href="https://github.com/cuongtranba/kanna/actions/workflows/release-please.yml"><img src="https://github.com/cuongtranba/kanna/actions/workflows/release-please.yml/badge.svg?branch=main" alt="Release Please" /></a>
  <a href="https://github.com/cuongtranba/kanna/blob/main/LICENSE"><img src="https://img.shields.io/npm/l/@cuongtran001/kanna.svg?style=flat&colorA=18181b&colorB=f472b6" alt="license" /></a>
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

- **Multi-provider support** — switch between Claude and Codex (OpenAI) from the chat input, with per-provider model selection, reasoning effort controls, and Codex fast mode
- **Project-first sidebar** — chats grouped under projects, with live status indicators (idle, running, waiting, failed)
- **Drag-and-drop project ordering** — reorder project groups in the sidebar with persistent ordering
- **Local project discovery** — auto-discovers projects from both Claude and Codex local history
- **Bulk import Claude Code sessions** — one-click import of existing `~/.claude/projects/` sessions with full transcript and seamless resume via the Claude Agent SDK
- **Rich transcript rendering** — hydrated tool calls, collapsible tool groups, plan mode dialogs, and interactive prompts with full result display
- **Quick responses** — lightweight structured queries (e.g. title generation) via Haiku with automatic Codex fallback
- **Plan mode** — review and approve agent plans before execution
- **Persistent local history** — refresh-safe routes backed by JSONL event logs and compacted snapshots
- **Auto-generated titles** — chat titles generated in the background via Claude Haiku
- **Session resumption** — resume agent sessions with full context preservation
- **WebSocket-driven** — real-time subscription model with reactive state broadcasting
- **Cloudflare tunnel via `expose_port` tool** — opt-in; the agent proactively calls the Kanna `expose_port` MCP tool with a port. In `always-ask` mode Kanna shows an inline "expose via Cloudflare" card for you to accept; in `auto-expose` mode `cloudflared tunnel --url` spawns immediately. Both modes are gated by the Cloudflare Tunnel setting

## Architecture

```
Browser (React + Zustand)
    ↕  WebSocket
Bun Server (HTTP + WS)
    ├── WSRouter ─── subscription & command routing
    ├── AgentCoordinator ─── multi-provider turn management
    ├── ProviderCatalog ─── provider/model/effort normalization
    ├── QuickResponseAdapter ─── structured queries with provider fallback
    ├── EventStore ─── JSONL persistence + snapshot compaction
    └── ReadModels ─── derived views (sidebar, chat, projects)
    ↕  stdio
Claude Agent SDK / Codex App Server (local processes)
    ↕
Local File System (~/.kanna/data/, project dirs)
```

**Key patterns:** Event sourcing for all state mutations. CQRS with separate write (event log) and read (derived snapshots) paths. Reactive broadcasting — subscribers get pushed fresh snapshots on every state change. Multi-provider agent coordination with tool gating for user-approval flows. Provider-agnostic transcript hydration for unified rendering.

## Requirements

- [Bun](https://bun.sh) v1.3.5+
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

| Command              | Description                  |
| -------------------- | ---------------------------- |
| `bun run build`      | Build for production         |
| `bun run check`      | Typecheck + build            |
| `bun run dev`        | Run client + server together |
| `bun run dev:client` | Vite dev server only         |
| `bun run dev:server` | Bun backend only             |
| `bun run start`      | Start production server      |

## Project Structure

```
src/
├── client/          React UI layer
│   ├── app/         App router, pages, central state hook, socket client
│   ├── components/  Messages, chat chrome, dialogs, buttons, inputs
│   ├── hooks/       Theme, standalone mode detection
│   ├── stores/      Zustand stores (chat input, preferences, project order)
│   └── lib/         Formatters, path utils, transcript parsing
├── server/          Bun backend
│   ├── cli.ts       CLI entry point & browser launcher
│   ├── server.ts    HTTP/WS server setup & static serving
│   ├── agent.ts     AgentCoordinator (multi-provider turn management)
│   ├── codex-app-server.ts  Codex App Server JSON-RPC client
│   ├── provider-catalog.ts  Provider/model/effort normalization
│   ├── quick-response.ts    Structured queries with provider fallback
│   ├── ws-router.ts WebSocket message routing & subscriptions
│   ├── event-store.ts  JSONL persistence, replay & compaction
│   ├── discovery.ts Auto-discover projects from Claude and Codex local state
│   ├── read-models.ts  Derive view models from event state
│   └── events.ts    Event type definitions
└── shared/          Shared between client & server
    ├── types.ts     Core data types, provider catalog, transcript entries
    ├── tools.ts     Tool call normalization and hydration
    ├── protocol.ts  WebSocket message protocol
    ├── ports.ts     Port configuration
    └── branding.ts  App name, data directory paths
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
| unset / `supervisor` | npm registry for `@cuongtran001/kanna` | `bun install -g @cuongtran001/kanna@latest`, exit 76, supervisor respawns | Default. End-user path for `bunx kanna`. |
| `pm2` | `git fetch` + `HEAD` vs `origin/main` | `git pull --ff-only` → cond. `bun install` → `bun run build` → `pm2 reload` | Dev/self-host path. Requires `KANNA_REPO_DIR`. |

To add another reload mechanism (e.g., docker, systemd), implement the two interfaces and branch inside `createUpdateStrategy`; no changes to `UpdateManager`, `server.ts`, or any client code are needed.

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
