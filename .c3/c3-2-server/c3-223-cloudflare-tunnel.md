---
id: c3-223
c3-version: 4
c3-seal: 02c6eb6575ce2e59f225ec1b3c420a09356509085e28925ee69085cb2411f9d9
title: cloudflare-tunnel
type: component
category: feature
parent: c3-2
goal: Detect listening dev-server ports from Bash tool output via a Haiku classifier and expose them through opt-in `cloudflared` quick tunnels.
uses:
    - ref-cqrs-read-models
    - ref-strong-typing
    - ref-ws-subscription
    - rule-strong-typing
---

# cloudflare-tunnel

## Goal

Detect listening dev-server ports from Bash tool output via a Haiku classifier and expose them through opt-in `cloudflared` quick tunnels.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-2 (server) |
| Parent Goal Slice | "Auto-tunnel agent-spawned local services through opt-in cloudflared quick tunnels" |
| Category | feature |
| Lifecycle | Per-chat lifecycle; tunnels disposed on chat close or source exit |
| Replaceability | Replaceable provided event union + WS command surface preserved |

## Purpose

Hooks into the Bash tool result path, classifies whether stdout indicates a listening dev server using a Haiku classifier, and offers/accepts a `cloudflared --url` quick tunnel. Non-goals: named tunnels, port allowlists, auto-installing cloudflared.

## Foundational Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Precondition | cloudflareTunnel.enabled set true in settings | c3-222 |
| Input — agent-coordinator | Bash tool entries | c3-210 |
| Input — process utils | Spawn cloudflared | c3-209 |
| Input — settings store | Reads enabled + mode + cloudflaredPath | c3-222 |
| Internal state | In-memory tunnel records (port, URL, lifecycle) | c3-223 |

## Business Flow

| Aspect | Detail | Reference |
| --- | --- | --- |
| Outcome | Users expose agent-started services without leaving Kanna | c3-2 |
| Primary path | Bash result → classifier → propose → accept → spawn tunnel | c3-208 |
| Alternate — auto-expose | mode: auto-expose skips proposal | c3-223 |
| Alternate — stop | User stop, source exit, chat close, server shutdown | c3-216 |
| Failure — classifier error | Skip without surfacing to user | c3-205 |

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-cqrs-read-models | ref | Tunnel state projected over WS | must follow | Push, never pull |
| ref-ws-subscription | ref | Reuses single-WS broadcast pipeline | must follow | No new push channel |
| ref-strong-typing | ref | Typed event union + injected interfaces | must follow | No any in classifier or spawner |
| rule-strong-typing | rule | Compliance target added by c3x wire; refine what must be reviewed or complied with before handoff. | wired compliance target beats uncited local prose | Added by c3x wire for explicit compliance review. |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| Tunnel projection | OUT | Adds tunnels + liveTunnelId to chat snapshot | c3-207 | src/server/cloudflare-tunnel/read-model.ts |
| tunnel.accept/tunnel.stop/tunnel.retry | IN | Typed WS commands | c3-208 | src/server/cloudflare-tunnel/gateway.ts |
| Bash-result hook | IN | Bridges agent tool output to classifier | c3-210 | src/server/cloudflare-tunnel/agent-integration.ts |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| Always-on regression | Default flips to enabled | Haiku calls without consent | bun run test src/server/cloudflare-tunnel/e2e.test.ts |
| Tunnel leak after chat close | Lifecycle hook skipped | cloudflared lingers post-session | Manual chat-close smoke + grep src/server/cloudflare-tunnel/lifecycle.ts for cleanup |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| src/server/cloudflare-tunnel/events.ts | c3-223 Contract | Event payload detail | src/server/cloudflare-tunnel/events.ts |
| src/server/cloudflare-tunnel/read-model.ts | c3-223 Contract | Projection detail | src/server/cloudflare-tunnel/read-model.ts |
| src/server/cloudflare-tunnel/detector.ts | c3-223 Contract | Classifier detail | src/server/cloudflare-tunnel/detector.ts |
| src/server/cloudflare-tunnel/tunnel-manager.ts | c3-223 Contract | Spawner detail | src/server/cloudflare-tunnel/tunnel-manager.ts |
| src/server/cloudflare-tunnel/gateway.ts | c3-223 Contract | WS command surface | src/server/cloudflare-tunnel/gateway.ts |
| src/server/cloudflare-tunnel/e2e.test.ts | c3-223 Contract | Integration test | src/server/cloudflare-tunnel/e2e.test.ts |
