---
id: c3-2
c3-version: 4
c3-seal: d672ec1b9d48f33ce5c3f767a04f9c22e31c547ccd5379bf288d3db107edaa50
title: Server
type: container
boundary: service
parent: c3-0
goal: 'Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models.'
---

## Goal

Run the local Bun backend: serve HTTP+WebSocket on localhost, coordinate Claude + Codex agent turns, persist events, and broadcast derived read models.

## Responsibilities

- Own the authoritative event log and derived read models; every state mutation lands as a JSONL event first.
- Accept WebSocket subscriptions and commands; push fresh snapshots on every change.
- Drive multi-provider agent turns (Claude Agent SDK, Claude CLI under PTY, Codex App Server) through a single coordinator.
- Host the in-process loopback MCP server for `mcp__kanna__*` shims and route interactive tool requests through a durable approval protocol that survives restart.
- Detect rate-limit / auth-error turn endings and auto-resume the chat at the right wake-up moment without user intervention.
- Discover local projects, manage terminals and uploads, operate share tunnels.
- Gate network access (auth), supervise its own CLI lifecycle, and refuse to leave localhost unless explicitly asked.

## Components

| ID | Name | Category | Status | Goal Contribution |
| --- | --- | --- | --- | --- |
| c3-201 | cli-entry | foundation | active | CLI parsing, supervisor, browser launcher |
| c3-202 | http-ws-server | foundation | active | HTTP + WS + static serving |
| c3-203 | auth | foundation | active | Password + session cookie gating |
| c3-204 | paths-config | foundation | active | Central data-path resolution |
| c3-205 | events-schema | foundation | active | Typed event unions for the log |
| c3-206 | event-store | foundation | active | Append-only JSONL + replay + snapshot compaction |
| c3-207 | read-models | foundation | active | Derived views from event state |
| c3-208 | ws-router | foundation | active | WS subscribe/command multiplexer |
| c3-209 | process-utils | foundation | active | Shared process lifecycle helpers |
| c3-210 | agent-coordinator | feature | active | Multi-provider turn orchestration |
| c3-211 | codex-app-server | feature | active | Codex App Server JSON-RPC adapter |
| c3-212 | provider-catalog | feature | active | Provider/model/effort normalization |
| c3-213 | quick-response | feature | active | Structured Haiku queries with Codex fallback |
| c3-214 | discovery | feature | active | Auto-discover local Claude + Codex projects |
| c3-215 | diff-store | feature | active | Per-chat diff state for file-change UI |
| c3-216 | terminal-manager | feature | active | PTY sessions for embedded terminal |
| c3-217 | uploads | feature | active | File upload handling |
| c3-218 | share | feature | active | Cloudflare quick + named tunnels + QR |
| c3-219 | update-manager | feature | active | npm version checking |
| c3-220 | restart | feature | active | In-place server relaunch |
| c3-221 | external-open | feature | active | Open URLs/files in external apps |
| c3-222 | keybindings | feature | active | Persist user keybindings |
| c3-223 | cloudflare-tunnel | feature | active | Detect dev-server ports and expose via cloudflared quick tunnels |
| c3-224 | oauth-token-pool | feature | active | Multi-account OAuth token pool: per-chat reservation, rate-limit/auth-error rotation, refusal classifier |
| c3-225 | claude-pty-driver | feature | active | Claude CLI PTY transport: parse subprocess stdout JSONL into normalized events, preserve subscription billing |
| c3-226 | kanna-mcp-host | feature | active | Loopback MCP server + built-in shims + durable approval protocol + path-deny |
| c3-227 | auto-continue | feature | active | Detect rate-limit / auth-error endings, schedule retries, replay queued prompts |
| c3-228 | session-share | feature | active | Mint read-only share tokens for finished chats; serve frozen snapshots at /share/:token without auth |
| c3-229 | workflow-status | feature | active | Disk-watch sidecar read-model for PTY workflow runs; WorkflowRegistry + WorkflowsSnapshot WS topic |
| c3-230 | openrouter-models | feature | active | Tool-capable OpenRouter model catalog: HTTPS fetch + parse + TTL cache; feeds the composer model picker via settings.listOpenRouterModels RPC |
| c3-231 | local-catalog | feature | active | Scan local Claude skills + slash commands (user, project, plugin) and merge them into ChatSnapshot.slashCommands so the composer / picker mirrors Claude Code |
| c3-232 | teams-registry | feature | active | In-memory per-chat Agent-SDK teammate task read-model feeding the teams WS topic + TeamsSection panel |
| c3-233 | turn-recovery | feature | active | Boot-time scan for crash/deploy-stopped turns; arms interrupted_resume auto-continue wakes so turns resume without user intervention |
