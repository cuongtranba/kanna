---
id: adr-20260525-remove-standalone-export-legacy
c3-seal: 1b178540cf30dd00795f4a4e2207b2c564469b379018d0229ad9aa5f50c17d9f
title: remove-standalone-export-legacy
type: adr
goal: 'Remove the legacy `chat.exportStandalone` code path — the upstream-`kanna.sh`-upload "Share chat" flow inherited from `jakemor/kanna` — from server, shared protocol, and client. The path is broken on this fork (returns `"No release viewer assets were found for 0.76.0."` because upstream only publishes viewer assets for `0.40.0` against `jakemor/kanna` releases, not against `cuongtranba/kanna`) and is fully superseded by the working session-share feature owned by `c3-228 session-share`. Outcome: a single share UX in the chat navbar (the `ShareButton` popover from `c3-228`), no orphaned upstream-upload code, no dead `StandaloneShareDialog`, no dead WS RPC, no dead types in `src/shared/types.ts`.'
status: implemented
date: "2026-05-25"
---

## Goal

Remove the legacy `chat.exportStandalone` code path — the upstream-`kanna.sh`-upload "Share chat" flow inherited from `jakemor/kanna` — from server, shared protocol, and client. The path is broken on this fork (returns `"No release viewer assets were found for 0.76.0."` because upstream only publishes viewer assets for `0.40.0` against `jakemor/kanna` releases, not against `cuongtranba/kanna`) and is fully superseded by the working session-share feature owned by `c3-228 session-share`. Outcome: a single share UX in the chat navbar (the `ShareButton` popover from `c3-228`), no orphaned upstream-upload code, no dead `StandaloneShareDialog`, no dead WS RPC, no dead types in `src/shared/types.ts`.

## Context

The legacy adapter `src/server/standalone-export.adapter.ts` PUTs a serialized transcript bundle to `https://kanna.sh/api/share/<slug>/transcript.json` and expects the upstream Cloudflare Worker to find matching `export-viewer__*` GitHub Release assets on the **upstream** `jakemor/kanna` repo for the bundle's `viewerVersion` (= local `package.json` version, currently `0.76.0`). Upstream only publishes those assets for `0.40.0`, so every share on this fork fails. The path was kept after the upstream merge because no one had a replacement. PR #318 (commit `c7a7245`, released as `0.76.0`) added the read-only session-share feature documented in `c3-228 session-share` with ADR `adr-20260524-session-share`: mint a token via WS, persist a frozen snapshot under `~/.kanna/shares/<token>.json`, serve it at `GET /share/:token` over the existing Cloudflare tunnel (`c3-218 share`), no third party involved. The new path is wired through the `ShareButton` / `SharePopover` components in the navbar (`src/client/components/share/`). The two paths now coexist: the legacy `UserRoundPlus` button in `ChatNavbar.tsx` triggers the broken upstream upload, while the adjacent `ShareButton` triggers the working session-share. Affected topology: `c3-2 server` (legacy WS handler + adapter live here, uncharted), `c3-3 shared` (legacy protocol cases + types), `c3-115 chat-ui-chrome` (legacy dialog + navbar button + state in `useKannaState`). The legacy code is uncharted in C3 — `c3x lookup src/server/standalone-export.adapter.ts` returns no match. Constraint: don't touch any code owned by `c3-228 session-share`, `c3-218 share`, `c3-306 share-shared`, or `c3-115 chat-ui-chrome` beyond pruning the prop/state surface that fed the dead button.

## Decision

Delete the entire legacy code path in this PR. Server side: remove `src/server/standalone-export.adapter.ts`, its colocated `*.test.ts`, the import and `case "chat.exportStandalone":` handler in `src/server/ws-router.ts`. Shared side: remove the `chat.exportStandalone` arm of the `WsCommand` union in `src/shared/protocol.ts`, the `StandaloneTranscript*` re-imports, the `StandaloneTranscriptExportResult` member of the `ack` `result` union, and the `StandaloneTranscript*` type families in `src/shared/types.ts`. Client side: remove `src/client/components/chat-ui/StandaloneShareDialog.tsx`, the `StandaloneShareDialog` import + mount in `src/client/app/App.tsx`, the `handleShareChat` destructure passed to `useKeyboardShortcuts` in `App.tsx`, all six handlers in `useKannaState.ts` (`handleExportStandalone`, `handleShareChat`, `handleCloseStandaloneShareDialog`, `handleOpenStandaloneShareLink`, `handleCopyStandaloneShareLink`), their state fields (`isExportingStandalone`, `standaloneShareUrl`, `standaloneShareComplete`), the unused `downloadTextFile` helper and `StandaloneTranscriptExportCommandResult` import, the `onExportTranscript` / `canExportTranscript` / `isExportingTranscript` / `exportTranscriptComplete` prop chain through `ChatNavbar.tsx` (both the compact dropdown variant and the main toolbar variant) and the wiring in `ChatPage/index.tsx`. Reasoning: option (a) "keep both, document one as broken" leaves two buttons that look identical to users and one will keep firing tickets. Option (b) "rewrite the legacy adapter to use the new snapshot" duplicates `c3-228`'s contract surface for zero user benefit. Option (c) "leave it for a future release" loses the cleanup window while context is hot. Deletion is the only outcome that produces one share UX and zero dead code. Removal is safe because the new path is shipped and the keyboard shortcut binding to `handleShareChat` is the only non-button caller — it is removed alongside.

## Affected Topology

| Entity | Type | Why affected | Governance review |
| --- | --- | --- | --- |
| c3-2 | container | Hosts the legacy WS RPC + adapter file being deleted | Confirm c3-228 remains the sole share component under c3-2 |
| c3-3 | container | Hosts the legacy chat.exportStandalone protocol case + StandaloneTranscript* types being deleted | Confirm c3-306 continues to own all live share types |
| c3-115 | component | Owns StandaloneShareDialog.tsx (file deleted), ChatNavbar.tsx (legacy button + prop chain pruned), and the legacy useKannaState slice | Confirm ChatNavbar.tsx keeps the new ShareButton/SharePopover slot from c3-228 untouched; remove dead props from component contract narrative if any |
| c3-228 | component | Not modified — it is the surviving share path; documented here as the reason legacy removal is safe | No-op: confirm no contract surface change |
| c3-218 | component | Not modified — Cloudflare tunnel that the surviving session-share depends on; documented here as still required | No-op |
| c3-306 | component | Not modified — owns live share types; documented here as the home for any share types remaining after the prune | No-op |

## Compliance Refs

| Ref | Why required | Action |
| --- | --- | --- |
| ref-side-effect-adapter | Legacy standalone-export.adapter.ts is correctly a .adapter.ts leaf; its deletion does not introduce new IO in non-adapter modules. After deletion, all share IO lives in session-share/snapshot-store.adapter.ts already governed by this ref. | comply |
| ref-strong-typing | Removing the StandaloneTranscript* type families must not introduce any in the union types that still mention them (the ack.result union, WsCommand). | comply |
| ref-local-first-data | Removing the only remote-upload code path strengthens compliance — no fork instance ever sends transcript data to a third party again. The surviving session-share already complies via ~/.kanna/shares/. | comply |
| ref-event-sourcing | Legacy path does not emit events, so deletion does not change the event schema. The surviving session-share's share.token_minted / share.token_expired events are unaffected. | N.A - legacy path bypasses event store |
| ref-cqrs-read-models | Same: legacy path reads store.getMessages directly and serializes inline; no read-model contract changes. | N.A - legacy path bypasses read models |

## Compliance Rules

| Rule | Why required | Action |
| --- | --- | --- |
| rule-zustand-store | Dead state being removed (isExportingStandalone, standaloneShareUrl, standaloneShareComplete) lives in useKannaState (server-derived hook), not a Zustand store, so the rule was not violated by the legacy code and the deletion does not relocate any client UI-local state. | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server adapter delete | Remove src/server/standalone-export.adapter.ts and src/server/standalone-export.adapter.test.ts | git rm src/server/standalone-export.adapter.ts src/server/standalone-export.adapter.test.ts |
| WS router prune | Remove import { writeStandaloneTranscriptExport } at ws-router.ts:22 and case "chat.exportStandalone": block at ws-router.ts:1850-1862 | src/server/ws-router.ts |
| Shared protocol prune | Remove the chat.exportStandalone member of WsCommand union (protocol.ts:238-242), the StandaloneTranscript* re-imports at top (protocol.ts:20-21), and StandaloneTranscriptExportResult from the ack result union (protocol.ts:321) | src/shared/protocol.ts |
| Shared types prune | Remove StandaloneTranscriptAttachmentMode, StandaloneTranscriptTheme, StandaloneTranscriptBundle, StandaloneTranscriptExportResult, StandaloneTranscriptExportFailureResult, StandaloneTranscriptExportCommandResult from src/shared/types.ts (lines 17-118) | src/shared/types.ts |
| Client dialog delete | Remove src/client/components/chat-ui/StandaloneShareDialog.tsx | git rm |
| App mount prune | Remove StandaloneShareDialog import + JSX mount in src/client/app/App.tsx (lines 5, 458-468), drop handleShareChat from destructure passed to useKeyboardShortcuts (lines 230, 252-253) | src/client/app/App.tsx |
| useKannaState prune | Remove handleExportStandalone, handleShareChat, handleCloseStandaloneShareDialog, handleCopyStandaloneShareLink, handleOpenStandaloneShareLink, the three setIsExportingStandalone/setStandaloneShareUrl/setStandaloneShareComplete state fields, the StandaloneTranscriptExportCommandResult import, the downloadTextFile helper, and all corresponding entries in the returned snapshot object | src/client/app/useKannaState.ts |
| ChatNavbar prune | Remove the onExportTranscript / canExportTranscript / isExportingTranscript / exportTranscriptComplete prop quartet from both the compact dropdown variant (lines 37-49, 79-95) and the main toolbar variant (lines 114-117, 153-156, 286-308, 331-352) of src/client/components/chat-ui/ChatNavbar.tsx | src/client/components/chat-ui/ChatNavbar.tsx |
| ChatPage prop prune | Remove the onExportTranscript/canExportTranscript/isExportingTranscript/exportTranscriptComplete quartet passed at src/client/app/ChatPage/index.tsx:957-960 | src/client/app/ChatPage/index.tsx |
| Verification | bun run lint + bun test src/server/ws-router + bun test src/server/session-share + bun test src/client/components/share + git grep -E 'exportStandalone|StandaloneShare|standalone-export|onExportTranscript|handleShareChat|handleExportStandalone|isExportingStandalone|standaloneShareUrl|standaloneShareComplete' src/ returns no matches | run after deletion |

## Underlay C3 Changes

| Underlay area | Exact C3 change | Verification evidence |
| --- | --- | --- |
| c3-2 component inventory | N.A - legacy standalone-export.adapter.ts is uncharted in c3-2 (verified via c3x lookup); deletion removes an uncharted file, no c3-2 doc edit required | c3x lookup src/server/standalone-export.adapter.ts returns matches: <empty> |
| c3-3 component inventory | N.A - the StandaloneTranscript* types in src/shared/types.ts are not enumerated in any c3-3 component contract; removal does not break a documented surface | c3x list shows c3-301..c3-307 with no entry referencing these types |
| c3-115 chat-ui-chrome contract | N.A - StandaloneShareDialog.tsx is not enumerated in c3-115's Derived Materials or Contract sections; the file is uncharted within the component | c3x read c3-115 --full body does not mention StandaloneShareDialog |
| ADR registry | This ADR adr-20260525-remove-standalone-export-legacy created at proposed; on completion transitioned to implemented | c3x list --include-adr |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| bun run lint | TypeScript noUnusedLocals + ESLint catch any dangling reference to removed types/handlers/props | CI workflow .github/workflows/test.yml runs bun run lint with --max-warnings=0 |
| bun test | Existing ws-router.test.ts, session-share suite, and share-store.test.ts must still pass after WS handler removal | CI runs bun test on every push to main |
| git grep final sweep | Manual check that no exportStandalone / StandaloneShare / standalone-export / onExportTranscript / handleShareChat / handleExportStandalone / isExportingStandalone token remains in src/ | git grep -E '<token>' src/ returns empty |
| Side-effect lint seal | ESLint no-restricted-imports already prevents new fetch/IO in non-adapter modules; deletion removes one of the legitimate .adapter.ts callers, no rule edit needed | eslint.config.js no-restricted-imports block |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Keep legacy path, document the broken state in README | Two share buttons with identical icons; users will keep hitting the broken one and filing tickets. Documentation cannot stop a button from being clicked. |
| Rewrite legacy adapter to mint a session-share token internally and return its URL | Duplicates c3-228 contract surface (mintShare) behind a second protocol case; doubles the WS surface forever for zero user benefit; the existing ShareButton already calls share.mint directly. |
| Move legacy code to a sibling fork and ship a Cloudflare Worker for cuongtranba/kanna releases (the original brainstorm from this session) | Owner explicitly redirected to "no host" → session-share already delivers that; reviving the Worker plan now is a regression. |
| Defer deletion to a future "cleanup" release | Loses the cleanup window while the context is hot in one head; the dead UI keeps shipping; same outcome but later and harder. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| Hidden caller of chat.exportStandalone outside useKannaState (e.g., a keyboard shortcut, a CLI script, a test fixture) breaks silently | Final git grep sweep for every removed identifier across src/, scripts/, tests/, and CLAUDE.md surfaces | git grep -E 'exportStandalone|StandaloneShare|standalone-export|onExportTranscript|handleShareChat|handleExportStandalone|isExportingStandalone|standaloneShareUrl|standaloneShareComplete' src/ scripts/ wiki/ returns empty |
| Removing downloadTextFile breaks a non-share consumer | Pre-deletion grep confirms downloadTextFile has exactly one caller (the deleted code path) | grep -rn 'downloadTextFile' src/ returns only the to-be-deleted call site |
| WsCommand ack.result union narrowing breaks a runtime branch | bun run lint flags any narrow on the removed type; bun test covers the ack path | bun run lint && bun test both pass |
| User press of keyboard shortcut previously bound to handleShareChat does nothing | Audit useKeyboardShortcuts callers in App.tsx; either remap to ShareButton trigger or drop the binding | grep -n 'handleShareChat|share' src/client/app/use-keyboard-shortcuts.ts (or equivalent) reviewed in the diff |
| Stale doc references to "Share chat" upload flow in wiki/ or docs/ | Sweep wiki/** and docs/** for legacy phrasing | grep -rn 'kanna.sh|exportStandalone|standalone-export' wiki/ docs/ reviewed and either removed or replaced with session-share reference |

## Verification

| Check | Result |
| --- | --- |
| bun run lint from repo root | exit 0, zero warnings |
| bun test src/server/ws-router.test.ts | all pass |
| bun test src/server/session-share/ | all pass (no regression to surviving share path) |
| bun test src/client/components/share/ | all pass |
| git grep -E 'exportStandalone|StandaloneShare|standalone-export|onExportTranscript|handleShareChat|handleExportStandalone|isExportingStandalone|standaloneShareUrl|standaloneShareComplete|downloadTextFile' src/ | empty output |
| Manual: open running Kanna, navigate to a chat, confirm exactly one share affordance (the ShareButton popover) is visible in the navbar | one button only |
| Manual: click ShareButton, mint a token, open the public URL in a private window, confirm read-only transcript renders | snapshot served at /share/<token> |
| c3x check | PASS |
| c3x set adr-20260525-remove-standalone-export-legacy status implemented after merge | terminal state recorded |
