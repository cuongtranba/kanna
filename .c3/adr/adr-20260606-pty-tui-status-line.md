---
id: adr-20260606-pty-tui-status-line
c3-seal: 8592c5415e19916b5c56cc5a6d0d55e8f8986990528a914212ab5ea14ab4b977
title: pty-tui-status-line
type: adr
goal: Surface Claude Code's live TUI spinner status line — e.g. `Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)` — in the Kanna chat header while a PTY-driven turn is running. The spinner is ephemeral terminal output Claude redraws in place; it never lands in the transcript JSONL that PTY mode treats as its sole event source. This ADR authorizes parsing that line out of the existing PTY output ring and publishing it as a new live-status field on `PtyInstanceState` (the same side channel that already carries RSS/CPU), then rendering it inline in `ChatNavbar` for the active chat. PTY driver only; SDK mode is out of scope.
status: implemented
date: "2026-06-06"
---

## Goal

Surface Claude Code's live TUI spinner status line — e.g. `Whirlpooling… (11m 11s · ↓ 40.5k tokens · almost done thinking with xhigh effort)` — in the Kanna chat header while a PTY-driven turn is running. The spinner is ephemeral terminal output Claude redraws in place; it never lands in the transcript JSONL that PTY mode treats as its sole event source. This ADR authorizes parsing that line out of the existing PTY output ring and publishing it as a new live-status field on `PtyInstanceState` (the same side channel that already carries RSS/CPU), then rendering it inline in `ChatNavbar` for the active chat. PTY driver only; SDK mode is out of scope.

## Context

Under `KANNA_CLAUDE_DRIVER=pty` the driver (c3-225) tails the on-disk transcript JSONL as the SOLE event source; PTY stdout is captured into a bounded 256 KB `OutputRing` used today ONLY for trust/dev-channels dialog detection and silent-exit failure synthesis. The spinner status line (running verb, elapsed time, live output-token count, thinking-effort phrase) is written to stdout via ANSI cursor redraws and is never serialized to the transcript, so Kanna currently cannot show it — users running PTY turns get no live "still thinking / N tokens" feedback that native Claude Code shows. `PtyInstanceState` (`src/shared/pty-instance.ts`) is already published per-chat to the client over the `pty-instances` WS topic and rendered by `PtyInstancesIndicator`; `ChatNavbar` already renders a per-chat status/duration block in its center. The constraint: this must NOT route through the transcript/turn HarnessEvent pipeline (c3-225 invariant — stdout is never the event source); it is live process metadata, the same category as the existing RSS/CPU sampler upserts.

## Decision

Add a pure parser `src/server/claude-pty/tui-status-line.ts` (`parseTuiStatusLine(ringTail): PtyTuiStatus | null`) that strips ANSI and extracts the last spinner line into `{ verb, elapsedSeconds, tokens, effort, raw }`. Add a nullable `tuiStatus: PtyTuiStatus | null` field to `PtyInstanceState`. The PTY driver's existing memory-sampler tick (driver.ts:581) — already firing every 2 s and already calling `ptyInstanceRegistry.upsert` — also parses `ring.tail()` and includes `tuiStatus` in the same patch. No new timer, no new transport: the existing `pty-instances` delta fan-out carries it to the client. The client adds a stable per-chat selector and `ChatNavbar` renders the line in its center status block when `currentChatId`'s instance has a non-null `tuiStatus`. This reuses the proven RSS/CPU live-status path verbatim and keeps the transcript pipeline untouched, so the c3-225 "stdout is never the event source" invariant holds — `tuiStatus` is process metadata, not a HarnessEvent. A tolerant regex + an escape hatch (parser returns null on no-match, UI hides) absorb spinner-format drift across `claude` versions, mirroring the existing trust-dialog `KANNA_PTY_TRUST_DISMISS` tolerance posture.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | Adds a new live-status field derived from the output ring + a new pure parser file under src/server/claude-pty; must stay within "stdout is never the event source" | Confirm tuiStatus flows via PtyInstanceState upsert, never via createJsonlEventParser/HarnessEvent stream |
| c3-2 | container | Server container owns the PtyInstanceState shape + registry fan-out being extended | Confirm new field crosses the WS boundary with a named type |
| c3-102 | component | PtyInstancesIndicator / live-status registry consumes PtyInstanceState; new field is additive | Confirm additive nullable field, no render-loop regression on new selector |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-provider-adapter | PTY transport adapter shape; the new field must not leak PTY-specific concerns into the provider-agnostic transcript/event model — it rides the separate live-status channel | comply |
| ref-event-sourcing | Guards the log-before-broadcast event pipeline; this ADR must stay OUT of that pipeline (live metadata, not an event) | comply |
| ref-colocated-bun-test | New parser + client selector + component changes require colocated *.test.ts(x) | comply |
| ref-cqrs-read-models | PtyInstanceState is a derived read-model; tuiStatus is a new read-model field projected from the output ring, never an authoritative/event-sourced value | comply |
| ref-strong-typing | PtyTuiStatus is a named type crossing the client↔server WS boundary and the shared module export; no untyped literal | comply |
| ref-ws-subscription | tuiStatus rides the existing pty-instances WS topic delta fan-out unchanged; no new subscription surface is added | comply |
| ref-zustand-store | usePtyInstanceForChat is a new zustand selector; must return a stable object ref or the stable null primitive (no fresh ?? [] ref) | comply |
| ref-side-effect-adapter | parseTuiStatusLine is pure and reads the existing in-memory OutputRing; no new node/Bun IO is introduced, driver IO stays adapter-bound | N.A - no new IO introduced |
| ref-local-first-data | tuiStatus is ephemeral in-memory live status surfaced per-tick; it is never persisted or replayed, so local-first storage concerns do not apply | N.A - ephemeral, never persisted |
| ref-tool-hydration | Feature touches neither tool definitions nor their hydration path | N.A - unrelated to tool hydration |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | PtyTuiStatus crosses the client↔server WS boundary and the shared module export; must be a named TS type, no untyped object literal | comply |
| rule-colocated-bun-test | tui-status-line.ts gets tui-status-line.test.ts; client selector + ChatNavbar changes get colocated tests | comply |
| rule-zustand-store | usePtyInstanceForChat selector must return a stable object ref or the stable null primitive so no React #185 render loop is introduced; covered by renderForLoopCheck | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Shared type | Add PtyTuiStatus interface + tuiStatus: PtyTuiStatus | null to PtyInstanceState |
| Parser | New pure parseTuiStatusLine(ringTail: string): PtyTuiStatus | null — ANSI strip + tolerant spinner regex |
| Driver wiring | In the memory-sampler tick, parse ring.tail() and add tuiStatus to the existing upsert patch | src/server/claude-pty/driver.ts:581 |
| Registry baseline | Default tuiStatus: null in the spawning baseline | src/server/claude-pty/pty-instance-registry.ts:151 |
| Client selector | Stable per-chat selector usePtyInstanceForChat(chatId) (EMPTY/null-stable) | src/client/stores/ptyInstancesStore.ts (+ .test.ts) |
| Client render | Render verb+elapsed+tokens+effort segment in ChatNavbar center block, gated on currentChatId instance tuiStatus | src/client/components/chat-ui/ChatNavbar.tsx |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template surface is touched; this is application code only | N.A - this ADR changes Kanna runtime + UI, not the c3x underlay | N.A - c3x check after c3x set status validates doc consistency only |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| tui-status-line.test.ts | Asserts parse of a real ANSI spinner sample → fields; returns null on non-matching / empty ring (drift tolerance) | src/server/claude-pty/tui-status-line.test.ts |
| driver.test.ts | Asserts a sampler tick upserts tuiStatus parsed from the ring tail | src/server/claude-pty/driver.test.ts |
| ptyInstancesStore.test.ts | Asserts per-chat selector returns stable ref + correct instance | src/client/stores/ptyInstancesStore.test.ts |
| c3-225 Change Safety grep | Existing grep pumpStdout | proc.stdout guard stays zero — parser reads the ring, not proc.stdout for events |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Parse spinner into a HarnessEvent and feed the transcript pipeline | Directly violates c3-225 "stdout is never the event source"; pollutes the SDK↔PTY parity contract with a PTY-only ephemeral signal |
| New dedicated WS topic + store for status line | Redundant — PtyInstanceState already fans per-chat to the client every 2 s; a parallel channel doubles transport for the same cadence |
| Client computes elapsed/tokens from transcript result events | Transcript only has per-turn FINAL usage; the live in-progress token count + thinking-effort phrase exist ONLY in stdout |
| Render in PtyInstancesIndicator popover only | User chose chat header for in-turn visibility; popover is hidden by default during a turn |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Spinner format changes across claude versions, regex stops matching | Tolerant regex; parser returns null on no-match; UI hides the segment (no crash, graceful degrade) | tui-status-line.test.ts null-on-unknown case |
| Stale tuiStatus persists after turn ends | Sampler stops on cleanup; tuiStatus cleared to null when ring tail no longer matches a live spinner; phase=exited hides it in UI | driver.test.ts: tick after stream end yields null tuiStatus |
| New client selector returns fresh ref each call → React #185 render loop | Stable EMPTY/null pattern per CLAUDE.md render-loop rule; renderForLoopCheck test | ptyInstancesStore.test.ts loop-check |
| 2 s sampler cadence makes elapsed counter visibly jump | Accept coarse cadence (matches RSS/CPU); raw line shown verbatim, no client interpolation in v1 | Manual: visual check in PTY chat |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/tui-status-line.test.ts | pass |
| bun test src/server/claude-pty/driver.test.ts | pass |
| bun test src/client/stores/ptyInstancesStore.test.ts | pass |
| bun run lint | 0 errors, warnings at/under cap |
| Manual PTY chat: long turn shows live verb+elapsed+tokens+effort in ChatNavbar, hides on completion | spinner line renders + clears |
