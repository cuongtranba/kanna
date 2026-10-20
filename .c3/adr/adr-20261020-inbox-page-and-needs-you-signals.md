---
id: adr-20261020-inbox-page-and-needs-you-signals
c3-seal: c37bc5a3ca8cd1251defe834c2c4d234fee10afb2f09b558f7b7323677f1e7d6
title: inbox-page-and-needs-you-signals
type: adr
goal: Record the decision to present the inbox as a workspace page tab with Inbox and Activity views, to interrupt the user only when a thread enters needs_you, and to add the inbox push kind, so the client component (c3-126) and the push component (c3-244) carry the contract the Inbox page relies on.
status: done
date: "2026-10-20"
---

## Goal

Record the decision to present the inbox as a workspace page tab with Inbox and Activity views, to interrupt the user only when a thread enters needs_you, and to add the inbox push kind, so the client component (c3-126) and the push component (c3-244) carry the contract the Inbox page relies on.

## Context

PR 2 added the server side of the inbox: threads, activity items, verdicts, reply and instruct. Nothing rendered them and nothing told the user. The user decided the agent pre-handles each message and only needs_you should reach them, that drafts are approved in the Inbox item rather than the chat transcript, that replied or archived threads leave the Inbox, and that every bus event stays browsable. Pages open as workspace tabs (adr-20261013-pages-as-workspace-tabs), the entry bundle is capped at 350000 gzip bytes, and the client bans useState and unrendered side effects.

## Decision

Add the inbox-ui component: an inboxStore filled by the global inbox subscription; a lazy InboxPage with Inbox and Activity tabs, day grouping, thread and activity rows drawn with the four marks, a thread detail with the agent's read and a reply composer seeded from the draft whose Send, Instruct and Archive controls render pending state; page-kind inbox with the thread id riding the tab path; a sidebar entry with a tabular unread badge; the window title count including inbox unread; useInboxToasts, which diffs needs-you thread ids per snapshot and shows at most three sonner toasts plus one overflow toast when the user is not on /inbox, importing sonner dynamically. The push component gains the inbox kind: notifyInbox ignores chat focus, dedupes on the thread id and last message time, and is wired through wireInboxPush, which honours the source handler's pushEnabled. The two placeholder fact ids in the new component's Derived Materials are corrected in the same unit.

## Affected Topology

| Entity | Type | Why affected | Evidence | Governance review |
| --- | --- | --- | --- | --- |
| c3-126 | component | New owner of the page, store, toasts, badge and title count; two Derived Materials rows name the fact itself | c3-126#n15095@v1:sha256:268fcbcada04a9d38531c29bc6a02e6360f26f2b7a601cef9eb884bb084c5c23 | Stable selectors, named store actions, pending state on every control, lazy chunk under the bundle cap |
| c3-244 | component | Gains the inbox push kind and its wiring | c3-244#n15174@v1:sha256:ed339dee8f295c09572f4c9ef97d230a00a825aa29f63bc1e2ef91e151baf2e0 | The payload shape and sw.js case ride the existing fan-out and dedupe; no focus skip |

## Work Breakdown

| Area | Detail | Evidence |
| --- | --- | --- |
| Store and helpers | inboxStore, inboxFilter, inboxPresentation, inboxCommands, the inbox subscription | src/client/stores/inboxStore.ts, src/client/lib/, src/client/app/useAppGlobalState.ts |
| Page | InboxPage, rows, detail, composer, filter bar; page-kind plumbing and sidebar entry | src/client/app/Inbox*.tsx, src/client/lib/paneTree/, src/client/components/panes/, src/client/app/SidebarUtilityNav.tsx |
| Notifications | useInboxToasts, title count, PushTransitionKind inbox, notifyInbox, sw.js case, wireInboxPush | src/client/app/useInboxToasts.ts, src/client/app/chatNotifications.ts, src/server/push/push-manager.ts, public/sw.js, src/server/inbox/inbox-boot.ts |

## Alternatives Considered

| Alternative | Rejected because |
| --- | --- |
| A bell dropdown in the sidebar | Pages open as workspace tabs; a second navigation model for one feature |
| Approve drafts as a card in the chat transcript | Two places to decide; the Inbox item is where the user opens the thread |
| Toast on every snapshot change | A chat that produces events would toast constantly; only a thread entering needs_you is an interrupt |
| Import sonner statically | Puts the toast library in the entry bundle for a surface most sessions never trigger |

## Risks

| Risk | Mitigation | Verification |
| --- | --- | --- |
| A toast fires again for a thread already known | The hook keeps the set of needs-you ids and diffs per snapshot | bun test --conditions production src/client/app/useInboxToasts.test.ts |
| A push goes to a device looking at the thread | Accepted: a thread belongs to no open chat, so focus cannot be known; the dedupe key bounds repeats | bun test --conditions production src/server/push/push-manager.test.ts |
| The Inbox page lands in the entry bundle | PageTabContent lazy-imports it | bun test --conditions production src/ops/architecture/budget.test.ts |

## Verification

| Check | Result |
| --- | --- |
| bun run typecheck, lint, lint:comments, lint:usestate, ast-grep test, check:arch | clean, no pin changed |
| bun run test | passes |
| bun run build:client and check:bundle | entry under the 350000 gzip budget |
