---
id: adr-20260803-stale-chunk-asset-404
c3-seal: 236a3b1fa810d3cbf828f825ffe4df72e0f82dfa29c4208f4ab34e0095feff1f
title: stale-chunk-asset-404
type: adr
goal: |-
    Stop a browser tab that outlived a deploy from dead-ending on a missing hashed chunk.
    Two behaviors change: the HTTP static handler must answer a missing **asset** request
    with a real `404` instead of falling back to `index.html`, and the client's lazy-module
    loader must stop caching a rejected `import()` so a later mount can retry — and must
    tell the user to reload rather than blaming the content it failed to render.
status: accepted
date: "2026-08-03"
---

## Goal

Stop a browser tab that outlived a deploy from dead-ending on a missing hashed chunk.
Two behaviors change: the HTTP static handler must answer a missing **asset** request
with a real `404` instead of falling back to `index.html`, and the client's lazy-module
loader must stop caching a rejected `import()` so a later mount can retry — and must
tell the user to reload rather than blaming the content it failed to render.

## Context

Kanna serves a Vite build whose chunks are content-hashed. On deploy the old hashed
chunks are deleted. A tab left open across that deploy keeps running the previous entry
chunk, so any *lazy* chunk it requests later no longer exists on disk.

Observed incident (chat `bf71cc2b-3c31-478d-8151-ba12989dd04c`, transcript at
`~/.kanna/data/transcripts/`): v1.9.0 was installed at 13:46:24 and pm2 restarted onto it
at 13:46:33. At **16:13:18** — 2 h 27 m later — the tab rendered a message containing four
Mermaid diagrams and requested `/assets/mermaid.core-BxJivhhJ.js`, a hash absent from the
1.9.0 build. Earlier in that same session all four diagrams had been parsed successfully by
real mermaid v11, so the diagram source was provably valid; the failure was purely
asset-loading.

Three defects compounded:

1. `serveStatic` (`src/server/server.ts`) falls back to `index.html` on *any* miss, so the
request returned `200 text/html`. The browser rejected HTML-as-a-module and raised the
opaque `Failed to fetch dynamically imported module`. A missing `.css` or `sw.js` was
masked identically.
2. `MermaidDiagram.tsx` cached the *rejected* promise in a module-level `mermaidPromise`,
so every later diagram in that tab stayed broken for the life of the tab even once a
chunk was reachable again.
3. The error UI attributed the failure to the diagram and offered no recovery, so the user
could not tell that a reload fixes it.

Constraint: `src/server/**` is side-effect sealed — filesystem access goes through
`server-io.adapter.ts`; `distDir` is already a documented test-only injection point, so the
server change is testable without touching production signatures.

## Decision

**Server** — classify a request by whether its last path segment carries a file extension.
Every SPA route is extensionless (`/`, `/chat/:chatId`, `/settings/:sectionId`,
`/workflows/:chatId`, `/share/:token`), so an extension is a reliable "this is a build
artifact" signal. A missing asset returns `404 text/plain` with `Cache-Control: no-store`;
`.html` is excluded so navigation documents keep falling back to the shell. The existing
`503` branch for a genuinely absent `index.html` is preserved.

Chosen over matching a fixed extension allowlist (needs editing whenever Vite emits a new
type) and over branching on the `Accept` header (proxies and preload requests vary it).

**Client** — add a pure helper `src/client/lib/lazyModule.ts` with `createLazyLoader`
(caches the resolved module, never the rejection) and `isStaleChunkError` (matches the
Chrome, Firefox *and* Safari wordings — a Chrome-only substring misses two engines).
`MermaidDiagram` consumes it, records `kind: "stale-chunk"` on the error state, and renders
a "This diagram needs the latest version of the app" line with an explicit **Reload**
button wired to `DomPort.reload()`. An explicit button — not an auto-reload — because
auto-reloading a chat app can discard an unsent draft.

The loader is injectable through the existing `ports` prop (the pattern already used for
`clipboard`/`timer` and by `MermaidZoomModal` for `dom`), which makes the stale-chunk path
testable without fighting the module registry.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-202 | component | Static handler gains a navigation-vs-asset distinction; a missing asset now 404s instead of returning the SPA shell | c3-202#n6773@v1:sha256:318adcf13909f5ff193a968c20a1f853df50ae1f3d5aca4443ab353397d8eae5 | Confirm the 404 branch cannot shadow /assets/share-view/* or any real file, and that /health + upgrade paths are untouched |
| c3-114 | component | MermaidDiagram gains a stale-chunk error kind, a dom/loadMermaid port, and a Reload control | c3-114#n6423@v1:sha256:1b4957f285eace4b8d7954037859c19e293bd53adf10b0c4fb89ba32eb172689 | Confirm the per-kind component stays pure and side effects stay behind an injected port |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-colocated-bun-test | Three new/changed test files must sit beside the code they cover | rule-colocated-bun-test#n9058@v1:sha256:6c733a6bc908ab2c89a563a0429d06eb34d56731aaa4a18067213c18dbdf6c8f "All test files must live in the same directory as the file under test" | comply — lazyModule.test.ts beside lazyModule.ts, static-serve.test.ts under src/server/, stale-chunk cases appended to MermaidDiagram.test.tsx |
| rule-strong-typing | The loader crosses a boundary that yields untyped rejection values | rule-strong-typing#n9119@v1:sha256:ab9d03265e99a9527350c213d779cbb270675fd943f331a80652bf0b80e692f8 "All boundary types must be named exports" | comply — rejections routed through toError from src/shared/errors.ts, the sanctioned unknown chokepoint; isStaleChunkError takes Error |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Server | Add isAssetRequest + the 404 branch in serveStatic | src/server/server.ts |
| Client lib | New pure createLazyLoader / isStaleChunkError | src/client/lib/lazyModule.ts |
| Client component | Consume the loader; add dom/loadMermaid ports; render the Reload affordance | src/client/components/messages/MermaidDiagram.tsx |
| Client store | Widen the error state with kind?: "stale-chunk" | src/client/components/messages/MermaidDiagram.store.ts |
| Docs | Record the asset-404 contract | docs/ |

## Enforcement Surfaces

| Surface | Behavior | Evidence |
| --- | --- | --- |
| src/server/static-serve.test.ts | Asserts a missing hashed chunk 404s and is not HTML, while extensionless SPA routes still return the shell | 6 tests, all green |
| src/client/lib/lazyModule.test.ts | Asserts rejections are not cached and all three engine wordings are detected | 11 tests, all green |
| src/client/components/messages/MermaidDiagram.test.tsx | Asserts the Reload control calls dom.reload(), a syntax error offers no Reload, and a later diagram retries after a failed load | 6 added tests, all green |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Auto-reload the page on a stale-chunk error | Kanna is a chat app; an unprompted reload can discard an unsent composer draft. The user gets an explicit control instead. |
| Extension allowlist (.js, .css, .map, …) in the server | Needs editing every time Vite emits a new asset type; "has an extension" is the invariant that actually holds, since no SPA route contains a dot. |
| Branch the SPA fallback on the Accept header | Proxies, modulepreload, and fetch-initiated module loads vary Accept unreliably; path shape is deterministic. |
| Only fix the server 404 | A correct 404 still leaves the tab's cached rejection poisoning every later diagram, and still gives the user no recovery path. |
| Version-stamp the client and force a global reload on mismatch | Much larger blast radius for this incident; the per-consumer retry plus an opt-in reload solves the observed failure without a new global mechanism. |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A future SPA route containing a dot would now 404 instead of loading the shell | Documented invariant: routes stay extensionless; all five current routes verified against src/client/app/App.tsx | static-serve.test.ts asserts /, /chat/demo, /settings/general, /workflows/abc all return the shell |
| The stale-chunk substring match misses a future engine wording | Detection is centralized in one helper with all three known wordings, matched case-insensitively | lazyModule.test.ts covers Chrome/Firefox/Safari strings plus negative cases |
| Dropping the loader cache could allow a retry storm on a persistently failing chunk | Retry only happens on a new mount, never in a loop; concurrent callers still share one in-flight import | lazyModule.test.ts "concurrent callers share one invocation"; MermaidDiagram.test.tsx render-loop check |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production | 4421 pass, 2 skip, 0 fail (374 files) |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0) | clean |
| bun test --conditions production src/client/lib/lazyModule.test.ts src/client/components/messages/MermaidDiagram.test.tsx src/server/static-serve.test.ts src/server/auth.test.ts | 47 pass, 0 fail; stable over 5 consecutive runs |
| Live probe against a real bun run build, server on :4399 | /assets/mermaid.core-BxJivhhJ.js → 404 text/plain (was 200 text/html); real chunk → 200 text/javascript; /chat/demo and / → 200 text/html |
