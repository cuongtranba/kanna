---
id: adr-20260715-adr-20260715-client-state-effect-architecture
c3-seal: dcafdb717895801ad78f19df22bf387348d1be89549a8098502bc2c89a61c3e9
title: adr-20260715-client-state-effect-architecture
type: adr
goal: Adopt Zustand (app/UI state + action orchestration) + React Query (HTTP server cache) + react-use-websocket (raw WS transport) as the client-side state and effect architecture for Kanna, with AST-hard-gated seals. Establishes `queryClient` singleton + `QueryClientProvider`, `SocketBridge` (useWebSocket mount), `socketStore`, `socket-protocol.ts` skeleton, and `ports/`+`adapters/` directory scaffolding.
status: accepted
date: "2026-07-15"
---

## Goal

Adopt Zustand (app/UI state + action orchestration) + React Query (HTTP server cache) + react-use-websocket (raw WS transport) as the client-side state and effect architecture for Kanna, with AST-hard-gated seals. Establishes `queryClient` singleton + `QueryClientProvider`, `SocketBridge` (useWebSocket mount), `socketStore`, `socket-protocol.ts` skeleton, and `ports/`+`adapters/` directory scaffolding.

## Context

Kanna already mandates Zustand for all client UI state (`rule-zustand-store`, `no-react-usestate` ast-grep gate — migration COMPLETE on branch `zustand-migration`). However, side effects remain scattered: `fetch` in ~10 files, `localStorage`/`sessionStorage` in ~9 files, `setTimeout`/`setInterval`/`requestAnimationFrame` in ~30 files, and `document`/`window`/`navigator` member access across ~50 files. The WebSocket connection is hand-rolled in `src/client/app/socket.ts` (KannaSocket class). No mechanical seal exists to prevent new code from adding raw browser-primitive call sites outside adapters.

The chosen architecture: Zustand actions decide per situation whether to issue a WS command or an HTTP request; React Query caches HTTP API call results; react-use-websocket provides the raw WS connection (with `filter:()=>false` + `onMessage` to suppress re-renders) while Kanna's existing protocol logic (correlation/ack/queue/heartbeat) stays on top; raw browser primitives migrate to `*.adapter.ts` leaf files behind typed port interfaces.

The server already has the `*.adapter.ts` seal pattern (`ref-side-effect-adapter`) enforced by ESLint. This ADR extends the same pattern to the client layer.

## Decision

1. **React Query** — module-level `queryClient` singleton (`src/client/query/queryClient.ts`) wrapped in `QueryClientProvider` at the App root. Zustand actions call `queryClient.fetchQuery`/`ensureQueryData`/`setQueryData` imperatively outside components; the WS dispatcher calls `setQueryData`/`invalidateQueries` to sync server-push updates into the cache.
2. **react-use-websocket** — `SocketBridge` component (`src/client/app/SocketBridge.tsx`) mounts `useWebSocket` once at App root with `filter:()=>false`+`onMessage`; writes `sendMessage`+`readyState` into `socketStore` (Zustand). Kanna's protocol layer (correlation/subscription/queue/heartbeat) stays in `socket.ts` until the dedicated burn-down chunk relocates it to `socket-protocol.ts`.
3. **socketStore** — new Zustand store (`src/client/stores/socketStore.ts`) holding raw transport state; written exclusively by SocketBridge; read by actions to send frames.
4. **socket-protocol.ts skeleton** — `src/client/app/socket-protocol.ts` staked out as the future home of protocol logic; currently a documented TODO; signals import target to later chunks.
5. **ports/ + adapters/ directories** — `src/client/ports/index.ts` + `src/client/adapters/index.ts` placeholder files establishing the pattern and naming convention; real port/adapter implementations are a later chunk.
6. **verify:client-arch script** — `package.json` gains `"verify:client-arch": "bunx ast-grep scan && bun run lint && bun run typecheck && bun run test"` as the oracle gate for the full migration. Initially exits non-zero (AST seal rules + lint overrides land in a later chunk); exits 0 only when the full burn-down passes.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-101 | component | SocketBridge adds a new WS transport contract surface; socketStore is the new mutable state surface written by SocketBridge; socket-protocol.ts will become the future evidence file for the contract | c3-101#n5558@v1:sha256:4ee4a849c21fcd50ae93e86365c5bf7ac6c45802c052e480b29e2d7442262a21 "Maintain the single WebSocket to the backend, decode typed envelopes, and dispatch commands + subscription push messages." | Update Contract table to add SocketBridge + socketStore surfaces; update Derived Materials in later chunk when socket.ts is retired |
| c3-102 | component | socketStore is a new concern under state-stores; its pattern (Zustand create, no server snapshots) is governed by this component; queryClient is the new server-cache surface that complements state management | c3-102#n5611@v1:sha256:d67b854a4ec698edc79613ae615dc5d2002600efd31b355af5ab989c3d41fcbe "Hold UI-local state (chat input, terminal layout, sidebar, preferences) in small Zustand stores, persisting only what must survive reload." | Update Goal, Purpose, and Contract to reflect socketStore and queryClient server-cache surface |
| c3-1 | container | New directories ports/ and adapters/ under src/client/ are in-scope for this container; App.tsx gains QueryClientProvider + SocketBridge at root | c3-1#n5536@v1:sha256:5eb742bf605636aba60e3877d57925f3ebd884f0a8dde010cc2e0313e09d635d "Own the browser-side state surface (Zustand stores, React context, URL routing)." | Confirm new directories fit the container Responsibilities — no container-level changes required |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-zustand-store | socketStore must follow the singleton concern pattern (create<T>(), one hook, colocated test) | ref-zustand-store#n8603@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply — socketStore follows the pattern; colocated test is a Phase 2 work item |
| ref-strong-typing | socketStore and all new files must use named types, no any | ref-strong-typing#n8504@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or the owning module." | comply — all new files use named interfaces |
| ref-side-effect-adapter | client ports/adapters/ mirror the server *.adapter.ts seal that this ref describes; the naming convention and leaf-module shape are the same | ref-side-effect-adapter#n8465@v1:sha256:d97da3a35cbbfc743202e4b37a53c5ae837c6f8c802bdd22685991e0bfe439ee "Keep every node:fs, node:child_process, node:http/https, bun:sqlite/better-sqlite3/pg, and Bun.spawn/Bun.$/Bun.file/Bun.serve/Bun.Terminal call site in a single, named, leaf-level wrapper file so the rest of src/server/** can stay pure and the seal is mechanically enforceable by ESLint without per-file allow-lists." | review — pattern replicated on client; full ESLint seal comes in Phase 3 chunk |
| ref-ws-subscription | SocketBridge + socketStore are the new typed WS dispatch surface this ref governs | ref-ws-subscription#n8570@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc "A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts." | review — SocketBridge satisfies the single-WS contract; update-ref deferred to when protocol layer moves |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | socketStore must conform to the two-form store contract (singleton at src/client/stores/, one concern, create<T>()) | rule-zustand-store#n8729@v1:sha256:32def6afa6b75b254116eb0bbd2baf8f39850999c7c08b0e21412ab585b23623 "All client state in Kanna lives in Zustand stores. Singleton feature state lives under src/client/stores/<concern>Store.ts (one concern per file, colocated <concern>Store.test.ts); per-instance component state lives in a colocated <Component>.store.ts built with createScopedStore from src/client/lib/createScopedStore.tsx. Server-derived truth lives ONLY in the WS-fed kannaStateStore, written exclusively by the useKannaState socket pipeline. Raw useState outside the frozen allowlist fails the no-react-usestate ast-grep CI gate (bun run lint:usestate)." | comply — socketStore satisfies all shape requirements |
| rule-strong-typing | socketStore and SocketBridge use named types throughout; no any/unknown escape | rule-strong-typing#n8697@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module exports) must have a named TypeScript type. No any, no unknown without narrowing, no untyped object literals at boundaries. This is a project-wide standard for every package in src/." | comply |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| package.json | Add verify:client-arch script | package.json scripts |
| @tanstack/react-query | Install v5.101.2; create src/client/query/queryClient.ts; wire QueryClientProvider in App.tsx | src/client/query/queryClient.ts, src/client/app/App.tsx |
| react-use-websocket | Install v4.13.0; create SocketBridge.tsx; write sendMessage+readyState into socketStore | src/client/app/SocketBridge.tsx |
| socketStore | New Zustand store for raw WS transport state | src/client/stores/socketStore.ts |
| socket-protocol.ts | Skeleton file staking out the future protocol layer home | src/client/app/socket-protocol.ts |
| ports/ adapters/ | Placeholder barrel files establishing directory + naming convention | src/client/ports/index.ts, src/client/adapters/index.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run lint on new files exits 0 (--max-warnings=0) | pass |
| bun run typecheck (TS7 --noEmit) exits 0 | pass |
| @tanstack/react-query installed at 5.101.2 | pass |
| react-use-websocket installed at 4.13.0 | pass |
| verify:client-arch script wired in package.json | pass |
