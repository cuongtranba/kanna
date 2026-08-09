---
id: adr-20260809-tab-status-indicator-parity
c3-seal: d2ac927f10979d2c80b537cc13d835f2c69e247c2137aa0ee96648f71c7aad6b
title: tab-status-indicator-parity
type: adr
goal: Make a chat tab in the pane tab strip carry the same live status indicators the sidebar row carries for that same chat — the status dot and the Claude PTY session glyph — by deriving both from one shared table (`src/client/lib/chatStatusIndicator.ts`) instead of letting each surface own its own copy. The decision being authorized is not "add a dot to a tab"; it is that the chat status vocabulary becomes a single shared derivation with exactly one definition, and every surface that draws chat status reads from it.
status: done
date: "2026-08-09"
---

## Goal

Make a chat tab in the pane tab strip carry the same live status indicators the sidebar row carries for that same chat — the status dot and the Claude PTY session glyph — by deriving both from one shared table (`src/client/lib/chatStatusIndicator.ts`) instead of letting each surface own its own copy. The decision being authorized is not "add a dot to a tab"; it is that the chat status vocabulary becomes a single shared derivation with exactly one definition, and every surface that draws chat status reads from it.

## Context

The pane tab strip lists the same chats the sidebar lists, but `describeTab` gave every chat tab a static `MessageSquare` icon. A chat mid-turn therefore read "Running" with an amber dot on the left and showed an indistinguishable icon on its tab; with the sidebar collapsed the signal was gone entirely. The user reported it directly, pointing at a screenshot of a running chat whose tab said nothing.

The constraint that shaped the fix is that the tone table (`status`/`unread` → tone → theme token, plus the `ClaudeSessionLifecycleStatus` → glyph map) lived as four module-private functions inside `src/client/components/chat-ui/sidebar/ChatRow.tsx`. The tab strip could not reach them without copying, and a copy is a second definition of one fact — it drifts the moment either side changes. `DESIGN.md`'s Color-Plus Rule adds a second constraint: a coloured mark may never be the only carrier of meaning.

Topology: c3-104 (pane-layout) owns what a tab shows via `tabPresentation.ts`; c3-111 (sidebar) owns the row. Neither owned the vocabulary itself, because it was not modelled as a thing.

## Decision

Extract the vocabulary into one pure module, `src/client/lib/chatStatusIndicator.ts`, exporting `chatStatusIndicator({status, unread}) → {tone, label} | null`, `chatDotBgClass`, `chatDotTextClass`, and `sessionStateBadge(state)`. `ChatRow` and `tabPresentation` both import it; neither keeps a local table. The sidebar's rendering is unchanged byte-for-byte, which is what makes the extraction provably behaviour-neutral — `KannaSidebar.test.tsx` passes untouched.

On a tab, the dot takes the icon's slot rather than sitting beside it. That choice is load-bearing twice over: a strip squeezed to icon-only tabs keeps the status it exists to show, and no tab pays horizontal width for a state most tabs are not in. The session glyph is secondary and yields its width first, rendering only while labels do. The status name rides an `sr-only` span and the tooltip, so colour never carries the meaning alone.

`TabPresentationContext` replaces `busyChatIds` with `chatStatuses`. "Busy" IS `status ∈ {running, starting}` — carrying both a status map and a busy-id set is two representations of one fact, exactly the shape this ADR exists to remove. `pinned` now derives from the single map.

The alternative of teaching `tabPresentation` its own colours was rejected for the reason above; the alternative of unifying `ChatNavbar`'s divergent palette (`statusLabel.ts` → emerald/amber utilities rather than `bg-warning`/`bg-info` tokens) was left out of scope because it changes navbar visuals nobody asked for. That divergence is recorded here as known.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-104 | component | tabPresentation gains the chat-status derivation and its context swaps busyChatIds for chatStatuses; the strip renders the dot and glyph. Contract + Change Safety both move. | c3-104#n7158@v1:sha256:a9d4107c7a4aea59659b92cf3141fe1740f7c9602f99911c614123bdcd1f2395 "Owns the pane tree as a pure data structure and the components that render it: a binary tree of split groups and leaf panes, each pane holding an ordered tab li" | ref-colocated-bun-test (new pure module carries its test), ref-strong-typing (no any across the new context shape) |
| c3-111 | component | ChatRow loses four private functions to the shared module. Rendering, tokens, and markup are unchanged, so no contract of the sidebar moves — recorded as affected because the code moved out of it. | c3-111#n7274@v1:sha256:7c9f99803dc8fd6c8b031a663e09bd53a738c6274c51b1956778cf479a294465 "Renders the project-first navigation: project groups with their chats, live agent status dots, drag-to-reorder, number-key shortcuts to jump chats. Non-goals: c" | Behaviour-neutrality proven by KannaSidebar.test.tsx passing with no test edits |

## Compliance Refs

| Ref | Why required | Evidence | Action |
| --- | --- | --- | --- |
| ref-colocated-bun-test | The change adds a new pure module, so it must carry its test beside it — src/client/lib/chatStatusIndicator.test.ts covers the full tone table, the running-outranks-unread precedence, and the cold-session null. | ref-colocated-bun-test#n9760@v1:sha256:9490f9305f79ff29d492d099b81c1227c5d277e4a16bf251c1779ddc338f4be8 "Tests sit next to the file under test, named *.test.ts(x), and run under bun test — no separate test directory, no framework churn." | comply |
| ref-strong-typing | TabPresentationContext gains chatStatuses, a new shape crossing from the chat route into the pane layer; it is a named ChatTabStatus interface reusing KannaStatus / ClaudeSessionLifecycleStatus from src/shared/types, with no any and no widening. | ref-strong-typing#n9963@v1:sha256:390cd8fee6d22c17530c1b9551d02cbd40ea33c56574b7ebc313f21961a707af "No any / untyped shapes at boundaries — everything that crosses client↔server, provider↔coordinator, or log↔read-model is a named type in src/shared or " | comply |
| ref-zustand-store | Cited by both affected components, so the change must not introduce an unstable selector. It does not: the map is built inside the existing useMemo over sidebarData in ChatPage, no new store, no new selector, no inline ?? {} fallback. | ref-zustand-store#n10062@v1:sha256:53e3365a2350860110617c32292965a5051709854e758fc7470752136627d86e "Client UI state lives in small Zustand stores scoped by concern (chat input, preferences, sidebar, terminal), persisted selectively via localStorage." | comply |
| ref-cqrs-read-models | Cited by c3-111. The tab dot is a pure read of the same server snapshot the sidebar row reads (SidebarChatRow); no new read model and no second source of chat status is introduced. | ref-cqrs-read-models#n9793@v1:sha256:768802027896fc8c9ebd415cf63483f64e0c5f2f4bc10f21079a8f7d51c38dcd "Separate write path (event log) from read path (derived views) so subscribers consume fast snapshots without replaying the log." | comply |

## Compliance Rules

| Rule | Why required | Evidence | Action |
| --- | --- | --- | --- |
| rule-zustand-store | Cited by c3-111, and the render-loop gates (no-unstable-selector-fallback, no-unstable-hook-fn-arg) apply to any new derived collection. chatStatuses is derived inside the pre-existing useMemo keyed on sidebarData, so no new hook and no fresh-reference selector is added; bun run lint:usestate and bunx ast-grep test are clean. | rule-zustand-store#n10188@v1:sha256:f4987b0b2521426050c0c2a5307760c102f3ed1e0a9334b074ed1913fe818f64 "All client state in Kanna lives in Zustand stores, and so does every transition of it." | comply |
| rule-colocated-bun-test | The new pure module and its test must obey the colocation rule: src/client/lib/chatStatusIndicator.test.ts sits beside its subject, shares its basename, and runs under bun test. | rule-colocated-bun-test#n10095@v1:sha256:ce58e026c1076cb18ede38f3a4bd73793f28bf1392d299399571ba446985623f "Every Kanna test must sit next to the file under test, share its basename, and run under" | comply |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| Copy the tone/glyph tables into tabPresentation.ts | Two definitions of one fact. The next palette or status change lands on one surface and the same chat reads differently in two places — the precise bug this ADR removes. |
| Add the dot beside the existing icon instead of in its slot | Costs every tab ~10px of label width permanently for a state most tabs are never in, and the icon-only strip (below the label threshold) would still drop it. |
| Full sidebar parity — also mirror ShieldAlert and the live Running 6:19 stamp | Tabs are floored near 40–120px wide; a duration stamp truncates the title it sits beside, and a live ticker on every tab adds a re-render source the strip does not otherwise have. |
| Fold ChatNavbar's palette into the shared module in the same change | Its emerald/amber utilities are a pre-existing divergence from the bg-warning/bg-info tokens; unifying it changes navbar visuals that were not part of the request. Left recorded, not silently altered. |

## Verification

| Check | Result |
| --- | --- |
| bun test --conditions production src/client/lib/chatStatusIndicator.test.ts src/client/components/panes/ | 141 + 12 pass, 0 fail |
| bun test --conditions production src/client/app/KannaSidebar.test.tsx — unmodified, proving the extraction is behaviour-neutral | pass |
| bun run test (full suite) | 5067 pass, 2 skip, 0 fail |
| bun run typecheck | clean |
| bun run lint (--max-warnings=0, carries the DESIGN hex/title gate) | clean |
| bunx ast-grep test + bun run lint:usestate | 14 pass, clean |
| bun run build:client | built |
| Real Chrome render of PaneTabStrip against the built stylesheet at wide and icon-only widths | dot + glyph at wide; dot survives, glyph yields at narrow; idle chat keeps its icon |
