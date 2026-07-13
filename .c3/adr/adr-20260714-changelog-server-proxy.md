---
id: adr-20260714-changelog-server-proxy
c3-seal: cefdb01a6ebeefc558d51931880901135e44213523b310ee658da20c5eb8715a
title: changelog-server-proxy
type: adr
goal: Route the Settings → Changelog release list through the Kanna server instead of fetching it directly from the browser. The client now issues a `settings.getChangelog` WebSocket command; the server fetches GitHub releases (preferring the authenticated `gh` CLI, falling back to an unauthenticated HTTP request) and returns them. This removes the browser's dependency on GitHub's 60 requests/hour unauthenticated per-IP limit.
status: proposed
date: "2026-07-14"
---

## Goal

Route the Settings → Changelog release list through the Kanna server instead of fetching it directly from the browser. The client now issues a `settings.getChangelog` WebSocket command; the server fetches GitHub releases (preferring the authenticated `gh` CLI, falling back to an unauthenticated HTTP request) and returns them. This removes the browser's dependency on GitHub's 60 requests/hour unauthenticated per-IP limit.

## Context

The changelog panel called `https://api.github.com/repos/cuongtranba/kanna/releases` directly from `SettingsPage.tsx` with no `Authorization` header. GitHub caps unauthenticated REST calls at 60/hr per client IP; once exhausted it returns HTTP 403 (`API rate limit exceeded`). Users behind shared NAT/VPN egress IPs, or who repeatedly pressed "Check for updates" (which force-bypasses the 5-minute client cache), hit the cap and saw "Could not load changelog — GitHub releases request failed with status 403". The repo is public, so this is purely a rate-limit problem, not authorization. The server already owns an authenticated GitHub path (`fetchGitHubPullRequests` in `diff-store.ts` uses `gh api` first, 5,000/hr) and a typed WS command router, so the fix reuses those existing seams. Affected topology: the client `settings-page` component, the server `diff-store` GitHub-fetch module, and the shared `protocol` command union.

## Decision

Add a server-side `fetchGitHubReleases(repoSlug, deps)` in `diff-store.ts` that mirrors the existing `fetchGitHubPullRequests` two-tier strategy (authenticated `gh api` first, unauthenticated `fetch` fallback) and filters draft releases. Expose it through a new `settings.getChangelog` command in the shared protocol, dispatched in `ws-router.ts`. The client's `loadChangelog` keeps its 5-minute in-memory cache but now takes an injected fetcher backed by `socket.command<GithubRelease[]>({ type: "settings.getChangelog" })` instead of calling GitHub. The `GithubRelease` type moves to `src/shared/types.ts` (re-exported from the client store) so both sides share one definition. This wins over hardening the client (longer cache / stale-on-403) because it structurally raises the effective limit to 5,000/hr and decouples it from the browser IP, matching the pattern the pull-request panel already uses.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-302 | component | Adds the settings.getChangelog request kind to the typed WS command union | c3-302#n7981@v1:sha256:4c7ecffd69e947220d2e183aff508ff27068adad53b1b11d4434236e59af2b8b "Define WebSocket wire envelopes (WsInbound, WsOutbound, subscribe/command kinds, correlation ids)." | Confirm envelope stays strongly typed (rule-strong-typing) |
| c3-215 | component | Gains fetchGitHubReleases sibling to fetchGitHubPullRequests; same gh-first/fetch-fallback IO pattern | c3-215#n6876@v1:sha256:0d280c0f0143bd71c03324d3d9e27e260bce8f837029243ee9fbef7b015bb53f "Maintain per-chat diff state for hydrated write_file/delete_file tool rendering and commit scaffolding." | Confirm IO stays in the diff-store module boundary |
| c3-116 | component | Changelog load switches from a direct browser GitHub fetch to the server command; keeps its cache | c3-116#n5982@v1:sha256:32c08a42142b635e1123890afca7af77faeda61d9f001a140e6404e2f6aef9b9 "Expose user settings: provider keys, theme, keybindings, chat preferences, notifications, data location." | Confirm "server command" primary path still holds; no new frozen-contract text |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-ws-subscription | The changelog now travels over the shared typed WebSocket as a correlation-id command; the new settings.getChangelog request/response must follow the one-socket command contract | ref-ws-subscription#n8536@v1:sha256:856dbc5b26887801a91ee1acf2a59bd940bd7592ddaa57b46a8689de86dd07cc "A single typed WebSocket handles both subscriptions (push) and commands (pull), with a shared envelope defined in src/shared/protocol.ts." | comply |
| ref-zustand-store | The client changelog state (releases, status, error) stays in the settings Zustand store; the fetcher only feeds it | ref-zustand-store#n8569@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-strong-typing | The new WS command and its GithubRelease[] response cross the client↔server boundary and must be concretely typed in the shared protocol union, not any | rule-strong-typing#n8663@v1:sha256:7e110467821b764c655f13db69c1331592e23c71af38ac5825037c97b15ea180 "All values crossing a Kanna boundary (client↔server WebSocket envelopes, JSONL events↔read-models, provider adapter↔agent coordinator, shared module expor" | comply |
| rule-zustand-store | Changelog releases/status remain in the settings Zustand store; no state escapes into component locals | rule-zustand-store#n8695@v1:sha256:32def6afa6b75b254116eb0bbd2baf8f39850999c7c08b0e21412ab585b23623 "All client state in Kanna lives in Zustand stores. Singleton feature state lives under src/client/stores/<concern>Store.ts (one concern per file, colocated `<" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Harden client only (longer TTL + serve-stale on 403) | Still bound to 60/hr per browser IP; shared-IP users can be blocked before their first request, so it only reduces frequency, not the root cause. |
| Embed a GitHub token in the client bundle | Leaks a credential to every browser and is trivially extractable; unacceptable for a public artifact. |

## Verification

| Check | Result |
| --- | --- |
| bun run lint | clean, 0 warnings |
| bun run typecheck | clean |
| bun test --conditions production src/server/diff-store.test.ts | 32 pass (incl. new fetchGitHubReleases gh-preferred / fetch-fallback / 403-throw cases) |
| bun test --conditions production src/client/app/SettingsPage.test.tsx | 18 pass (loadChangelog uses injected server fetcher) |
