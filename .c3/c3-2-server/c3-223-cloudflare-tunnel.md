---
id: c3-223
c3-version: 4
c3-seal: 02c6eb6575ce2e59f225ec1b3c420a09356509085e28925ee69085cb2411f9d9
title: cloudflare-tunnel
type: component
category: feature
parent: c3-2
goal: Let the agent proactively propose Cloudflare quick tunnels for local ports via the Kanna `expose_port` MCP tool; the user always accepts or dismisses each proposal.
uses:
    - ref-cqrs-read-models
    - ref-strong-typing
    - ref-ws-subscription
    - rule-strong-typing
---

# cloudflare-tunnel

## Goal

Let the agent proactively propose Cloudflare quick tunnels for local ports via the Kanna `expose_port` MCP tool; the user always accepts or dismisses each proposal.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Expose agent-started local services through opt-in cloudflared quick tunnels via an agent-callable tool" |
| Category | feature |
| Lifecycle | Per-chat lifecycle; tunnels disposed on chat close or source exit |
| Replaceability | Replaceable provided event union + WS command surface preserved |

## Purpose

Exposes a Kanna MCP tool (`mcp__kanna__expose_port`) that the agent calls proactively after starting a local server. Each call records a `tunnel_proposed` event the UI renders as an accept/dismiss card. Acceptance spawns `cloudflared --url` and projects state over WS. Non-goals: named tunnels, port allowlists, auto-installing cloudflared, bash-output port detection, automatic acceptance.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | cloudflareTunnel.enabled set true in settings | c3-222 |
| Input — agent MCP tool | `expose_port` calls into TunnelGateway | c3-210 |
| Input — process utils | Spawn cloudflared | c3-209 |
| Input — settings store | Reads enabled + cloudflaredPath | c3-222 |
| Internal state | In-memory tunnel records (port, URL, lifecycle) | c3-223 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users expose agent-started services without leaving Kanna | c3-2 |
| Primary path | Agent calls `expose_port` → propose → user accepts → spawn tunnel | c3-208 |
| Alternate — already live | Duplicate proposal for same port returns `already_live` | c3-223 |
| Alternate — disabled | Settings disabled returns `disabled`, no event | c3-222 |
| Alternate — stop | User stop, source exit, chat close, server shutdown | c3-216 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-cqrs-read-models | ref | Tunnel state projected over WS | must follow | Push, never pull |
| ref-ws-subscription | ref | Reuses single-WS broadcast pipeline | must follow | No new push channel |
| ref-strong-typing | ref | Typed event union + injected interfaces | must follow | No any in gateway or spawner |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Tunnel projection | OUT | Adds tunnels + liveTunnelId to chat snapshot | c3-207 | src/server/cloudflare-tunnel/read-model.ts |
| tunnel.accept/tunnel.stop/tunnel.retry | IN | Typed WS commands | c3-208 | src/server/cloudflare-tunnel/gateway.ts |
| `expose_port` MCP tool | IN | Agent-callable tool that calls `TunnelGateway.proposeFromTool` | c3-210 | src/server/kanna-mcp.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Always-on regression | Default flips to enabled | Tunnels spawn without user consent | bun test src/server/cloudflare-tunnel/e2e.test.ts |
| Tunnel leak after chat close | Lifecycle hook skipped | cloudflared lingers post-session | Manual chat-close smoke + grep src/server/cloudflare-tunnel/lifecycle.ts for cleanup |
| Silent auto-accept regression | `accept` triggered without user action | tunnel_accepted with non-"user" source | grep `source: "user"` in src/server/cloudflare-tunnel/gateway.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/cloudflare-tunnel/events.ts | c3-223 Contract | Event payload detail | src/server/cloudflare-tunnel/events.ts |
| src/server/cloudflare-tunnel/read-model.ts | c3-223 Contract | Projection detail | src/server/cloudflare-tunnel/read-model.ts |
| src/server/cloudflare-tunnel/tunnel-manager.ts | c3-223 Contract | Spawner detail | src/server/cloudflare-tunnel/tunnel-manager.ts |
| src/server/cloudflare-tunnel/gateway.ts | c3-223 Contract | WS command + propose API | src/server/cloudflare-tunnel/gateway.ts |
| src/server/kanna-mcp.ts | c3-223 Contract | `expose_port` MCP tool wiring | src/server/kanna-mcp.ts |
| src/server/cloudflare-tunnel/e2e.test.ts | c3-223 Contract | Integration test | src/server/cloudflare-tunnel/e2e.test.ts |
