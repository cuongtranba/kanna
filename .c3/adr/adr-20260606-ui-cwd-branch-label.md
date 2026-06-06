---
id: adr-20260606-ui-cwd-branch-label
c3-seal: 44d749f6ac9d006ac536ddf8d2e8bdc73d8fbaac70b5ecce0a82349df09dff35
title: ui-cwd-branch-label
type: adr
goal: Change the chat navbar's git label so it shows the chat's working directory as a home-relative path (`~/repo/.../worktree`) joined with the current branch, instead of only the worktree basename. The full `cwd` becomes visible in the existing `ChatNavbar` git label, satisfying the request to surface the current pwd alongside the branch in the Kanna UI.
status: implemented
date: "2026-06-06"
---

## Goal

Change the chat navbar's git label so it shows the chat's working directory as a home-relative path (`~/repo/.../worktree`) joined with the current branch, instead of only the worktree basename. The full `cwd` becomes visible in the existing `ChatNavbar` git label, satisfying the request to surface the current pwd alongside the branch in the Kanna UI.

## Context

`branchLabel()` (`src/client/lib/branchLabel.ts`) renders `<basename> · <branch>` in `ChatNavbar` (`src/client/components/chat-ui/ChatNavbar.tsx:313`). Only the last path segment is shown, so the user cannot see which directory a chat actually runs in. The user asked to display the current pwd (home-relative) plus branch, reusing the component that already shows the branch. The client (browser) has no `$HOME`, so a home-relative collapse needs `homeDir` delivered from the server. The `LocalProjectsSnapshot.machine` object already ships `platform` to the client over the `local-projects` WS topic — it is the natural carrier for `homeDir`. Affected topology: shared types (c3-301), read-models (c3-207), ws-router (c3-208), chat-page client (c3-112). Branch freshness is "on chat load" — no new fs watch; reuses the existing snapshot/diff branch source.

## Decision

Add `homeDir: string` to `LocalProjectsSnapshot.machine`, populate it in `deriveLocalProjectsSnapshot` from a new injected `homeDir` argument supplied by `ws-router` (`os.homedir()`, already imported/used there at lines 228/359 and not on the side-effect seal list). Thread `homeDir` from `state.localProjects?.machine.homeDir` into `ChatNavbar` and on into `branchLabel()`, which collapses a `homeDir` prefix of `localPath` to `~` and returns `<~/relative/path> · <branch>` (falling back to the full absolute path when no prefix match, and to the prior basename behavior when `homeDir` is absent). The long label is wrapped in the project `Tooltip` (full path on hover) and widened. This wins over a client-side heuristic (`/Users/<x>/` / `/home/<x>/` regex) because the injected `homeDir` is exact and portable across platforms; it wins over a per-chat server-computed display string because `homeDir` is a single machine-global value already co-located with `platform`.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-301 | component | Adds homeDir to LocalProjectsSnapshot.machine wire shape | ref-strong-typing: typed field, no optional escape |
| c3-207 | component | deriveLocalProjectsSnapshot gains homeDir param + output field | ref-cqrs-read-models: derive snapshot only, no IO |
| c3-208 | component | Supplies os.homedir() at the local-projects snapshot call site | ref-side-effect-adapter: confirm os.homedir not sealed |
| c3-112 | component | Threads homeDir prop from snapshot into ChatNavbar | ref-ws-subscription: read snapshot projection only |
| c3-115 | component | ChatNavbar + branchLabel render home-relative path + branch | rule-zustand-store N.A (pure prop render) |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-strong-typing | New homeDir field crosses the WS boundary; must be a concrete typed string, not optional/any | comply |
| ref-cqrs-read-models | deriveLocalProjectsSnapshot is a read projection; homeDir must be passed in, not read via IO inside it | comply |
| ref-side-effect-adapter | os.homedir() is the only IO; confirm it is allowed in ws-router (already used there) and not introduced into the pure read-model | comply |
| ref-ws-subscription | homeDir is delivered through the existing local-projects snapshot subscription, no new transport | comply |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-strong-typing | homeDir and the branchLabel input must be concretely typed at the boundary | comply |
| rule-zustand-store | Label is a pure prop render; no new store state introduced | N.A - no client store state added |
| rule-colocated-bun-test | New branchLabel home-collapse logic needs a colocated test | comply (extend src/client/lib/branchLabel.test.ts) |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| types | Add homeDir: string to LocalProjectsSnapshot.machine | src/shared/types.ts:575 |
| read-model | deriveLocalProjectsSnapshot(state, discovered, machineName, homeDir) emits homeDir | src/server/read-models.ts:163,198 |
| ws-router | Pass os.homedir() into the derive call | src/server/ws-router.ts:818 |
| branchLabel | Accept homeDir; collapse prefix to ~; return full home-relative path · branch | src/client/lib/branchLabel.ts |
| branchLabel test | Cover home-collapse, non-prefix fallback, missing-homeDir basename fallback | src/client/lib/branchLabel.test.ts |
| ChatNavbar | Add homeDir prop → computeBranchLabel; widen label, wrap in project Tooltip | src/client/components/chat-ui/ChatNavbar.tsx:143,313 |
| chat-page | Pass homeDir={state.localProjects?.machine.homeDir} | src/client/app/ChatPage/index.tsx:964,1002 |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| N.A - no C3 CLI/validator/schema change | This ADR changes product code only; no c3x command, validator, hint, or template is touched | c3x check passes post-change |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/client/lib/branchLabel.test.ts | Fails if home-collapse / fallback logic regresses | bun test src/client/lib/branchLabel.test.ts |
| bun run lint | Side-effect seal fails if IO leaks into read-model; strong-typing keeps field non-any | bun run lint |
| tsc (bun run check) | Compile error if homeDir not threaded through every call site | type error on missing prop/arg |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Client-side regex collapse of /Users/<x>/ & /home/<x>/ | Heuristic, breaks on non-standard home roots; injected homeDir is exact and platform-agnostic |
| Per-chat server-computed localPathDisplay field | homeDir is one machine-global value; co-locating with existing machine.platform avoids per-chat plumbing across the runtime read-model |
| New fs.watch for live branch | User chose "on chat load"; reuses existing branch source, avoids watcher cost |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Long path overflows navbar | Widen container + truncate + project Tooltip shows full path | manual navbar smoke + visual check |
| homeDir undefined on old snapshot during reconnect | branchLabel falls back to prior basename behavior when homeDir absent | unit test: missing-homeDir case |
| Prefix mismatch (symlinked / /private/var home) | Fall back to full absolute path when localPath does not start with homeDir | unit test: non-prefix case |

## Verification

| Check | Result |
| --- | --- |
| bun test src/client/lib/branchLabel.test.ts | pass |
| bun run lint | 0 errors, within warning cap |
| bun run check (tsc) | no type errors |
| manual navbar smoke | label shows ~/.../worktree · branch, tooltip full path |
