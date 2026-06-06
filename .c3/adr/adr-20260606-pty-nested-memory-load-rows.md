---
id: adr-20260606-pty-nested-memory-load-rows
c3-seal: 9f0dd27aae795e3dafac146cd13e1ce053523c58a9b80b1a88508beb90b2e514
title: pty-nested-memory-load-rows
type: adr
goal: Surface Claude Code's memory-file loads ("Loaded CLAUDE.md", "Loaded .claude/rules/*.md") in Kanna's PTY-driver transcript. Today the PTY transcript JSONL carries one `type:"nested_memory"` line per loaded memory/rule file (with `attachment.path` + `attachment.content`), but `createJsonlEventParser` drops it, so the UI shows the `Read(...)` tool row yet none of the "Loaded" lines a native `claude` TUI prints. Add a new `memory_loaded` transcript-entry kind, parse `nested_memory` into it in the PTY parser only, and render a compact path pill. SDK driver is out of scope.
status: implemented
date: "2026-06-06"
---

## Goal

Surface Claude Code's memory-file loads ("Loaded CLAUDE.md", "Loaded .claude/rules/*.md") in Kanna's PTY-driver transcript. Today the PTY transcript JSONL carries one `type:"nested_memory"` line per loaded memory/rule file (with `attachment.path` + `attachment.content`), but `createJsonlEventParser` drops it, so the UI shows the `Read(...)` tool row yet none of the "Loaded" lines a native `claude` TUI prints. Add a new `memory_loaded` transcript-entry kind, parse `nested_memory` into it in the PTY parser only, and render a compact path pill. SDK driver is out of scope.

## Context

PTY mode (`KANNA_CLAUDE_DRIVER=pty`, c3-225) tails the on-disk transcript JSONL as its SOLE event source (c3-225 invariant; adr-225). Real `entrypoint:"cli"` transcripts on disk contain `type:"nested_memory"` entries — confirmed by scanning `~/.claude/projects/**/*.jsonl` (7 cli sessions carry them; keys: `attachment.{type,path,content}`). `createJsonlEventParser` (`src/server/claude-pty/jsonl-to-event.ts`) handles only assistant/user/result/system-subtypes and rate-limit; `normalizeClaudeStreamMessage` (`agent.ts`, shared by both drivers) has no `nested_memory` case, so the line is silently discarded. Affected topology: c3-225 (PTY parser), c3-301 (shared transcript types — the JSONL→read-model boundary), c3-115 (chat-ui transcript renderer). User pain: PTY sessions hide which CLAUDE.md / rule files were auto-loaded, info a native TUI shows. Constraint: must stay inside the c3-225 "transcript JSONL is the only event source" rule (no new IO, no new disk watch) and rule-strong-typing (named type at the boundary).

## Decision

Add a no-content `memory_loaded` transcript entry `{ kind: "memory_loaded"; path: string }` (path pill only per product decision; content NOT carried — keeps read-model payload light and avoids leaking full file bodies into the persisted event log). Parse `type:"nested_memory"` ONLY in `createJsonlEventParser` (PTY), reading `attachment.path`; emit `{type:"transcript", entry: timestamped({kind:"memory_loaded", path})}`. Leaving `normalizeClaudeStreamMessage` untouched keeps the SDK driver behaviour unchanged (scope = PTY only) and avoids a parity-matrix delta. Hydrate raw→`HydratedTranscriptMessage` in `parseTranscript.ts`; render a compact single-line pill mirroring the existing divider-style rows (`CompactBoundaryMessage`). This wins over routing through the shared normalizer (would pull SDK into scope) and over a sidecar read-model like the workflow watcher (overkill — the data is already in the sole event source; a new read-model would add unjustified surface).

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-225 | component | jsonl-to-event.ts gains a nested_memory parse branch | Confirm c3-225 sole-event-source invariant still holds (no new IO); colocated parser test |
| c3-301 | component | New MemoryLoadedEntry + union members at the JSONL→read-model boundary | rule-strong-typing: named type, no untyped literal |
| c3-115 | component | New render case + MemoryLoadedMessage component + row-height + dedup | rule-strong-typing; render-loop stability (no new store selector here) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-event-sourcing | New entry kind is appended to / replayed from the JSONL event log; must carry stable serializable fields | comply |
| ref-provider-adapter | Entry must normalize into the shared transcript model so the UI never branches on provider | comply (PTY emits the same shared TranscriptEntry kind the renderer consumes) |
| ref-strong-typing | MemoryLoadedEntry is a named type added to c3-301's transcript-entry boundary union; no any/untyped literal | comply |
| ref-colocated-bun-test | New parse + hydrate + render behaviour needs colocated tests | comply |
| ref-zustand-store | Cited by c3-115; render is a pure prop-driven message component, introduces no new store or selector | N.A - no store/selector added |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | memory_loaded crosses client↔server + JSONL↔read-model boundaries; needs a named TS type, no any/untyped literal | comply |
| rule-colocated-bun-test | Tests sit next to each changed file, run under bun test | comply |
| rule-zustand-store | Cited by c3-115; no new use*Store selector is introduced, so the stable-reference render-loop rule has no new surface to govern | N.A - no store/selector added |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| shared types | Add MemoryLoadedEntry { kind:"memory_loaded"; path:string }, add to TranscriptEntry union + HydratedTranscriptMessage union | src/shared/types.ts |
| PTY parser | In createJsonlEventParser, branch on message.type === "nested_memory", read attachment.path, emit memory_loaded transcript entry | src/server/claude-pty/jsonl-to-event.ts (+ .test.ts) |
| client hydrate | case "memory_loaded" in parseTranscript builds the hydrated message | src/client/lib/parseTranscript.ts (+ .test.ts) |
| client render | case "memory_loaded" → <MemoryLoadedMessage path>; add to sameMessage dedup; new component | src/client/app/KannaTranscript.tsx, src/client/components/messages/MemoryLoadedMessage.tsx (+ .test.tsx) |
| client height | Add memory_loaded to the 40px row-height case | src/client/app/ChatPage/utils.ts |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema/template surface is changed by this ADR | This is a product code change governed by existing refs/rules; no .c3/ underlay tooling is touched | c3x check passes post-change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| jsonl-to-event.test.ts | Feeding a nested_memory line yields exactly one memory_loaded transcript event with the right path; non-memory lines unaffected | bun test |
| parseTranscript.test.ts | Raw memory_loaded entry hydrates to a memory_loaded message carrying path | bun test |
| MemoryLoadedMessage.test.tsx | Renders the path; no render-loop warning | bun test |
| parity-matrix.test.ts (existing) | Still green — proves SDK driver path is unchanged (no nested_memory handling added to the shared normalizer) | bun test |
| bun run lint | rule-strong-typing + side-effect seal hold (no any, no new IO) | lint exit 0 |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Handle nested_memory in shared normalizeClaudeStreamMessage | Pulls the SDK driver into scope (product decision = PTY only) and forces a parity-matrix delta for no requested benefit |
| Carry attachment.content on the entry | Product decision = path pill only; content bloats the persisted/replayed event log and risks leaking full file bodies |
| New disk-watch sidecar read-model (à la workflow watcher) | Overkill — data already lives in the c3-225 sole event source; a new read-model adds IO + transport surface for nothing |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| attachment.path shape changes / missing in a future CLI build | Guard: emit only when attachment.path is a non-empty string, else drop the line (no throw) | parser test feeds a malformed nested_memory line and asserts zero events |
| Noise — many rule files = many pills flooding the transcript | Compact single-line 40px pill, same low-emphasis divider styling as compact/context-cleared rows | MemoryLoadedMessage.test.tsx + visual review via impeccable |
| Render-loop regression (#185) from a new render case | No new store selector introduced; renders a static prop pill only | existing renderForLoopCheck-style mount test shows no loop warning |

## Verification

| Check | Result |
| --- | --- |
| bun test src/server/claude-pty/jsonl-to-event.test.ts | pass |
| bun test src/client/lib/parseTranscript.test.ts | pass |
| bun test src/client/components/messages/MemoryLoadedMessage.test.tsx | pass |
| bun test src/server/claude-pty/parity-matrix.test.ts | pass (SDK path unchanged) |
| bun run lint | exit 0, no new warnings |
| c3x check | pass |
