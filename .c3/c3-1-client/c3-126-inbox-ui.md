---
id: c3-126
c3-seal: fd9d77f23c5ca771bf1308e62a6aa99a0d958efef8b46a4f65c2404c7629f3bf
title: inbox-ui
type: component
category: feature
parent: c3-1
goal: Give the user one page where inbound threads and attention items are read, the agent's verdict and draft are reviewed, and a reply or instruction is sent, and make a thread that needs them reach them through a toast, the sidebar badge, the window title and a push notification.
uses:
    - ref-strong-typing
    - ref-ws-subscription
    - ref-zustand-store
    - rule-zustand-store
---

## Goal

Give the user one page where inbound threads and attention items are read, the agent's verdict and draft are reviewed, and a reply or instruction is sent, and make a thread that needs them reach them through a toast, the sidebar badge, the window title and a push notification.

## Parent Fit

| Field | Value |
| --- | --- |
| Container | c3-1 Client |
| Runtime | In the browser. The inbox store is filled by the global inbox subscription; the page is a lazy chunk opened as a workspace page tab; the toast hook runs once in the app shell. |
| Consumers | c3-247 inbox serves the inbox topic and the six inbox commands; c3-244 push-notifications sends the inbox push kind; c3-110 app-shell mounts the routes, the title count and the toast hook; c3-104 pane tabs hold the inbox page kind. |
| Boundary | Owns presentation and local view state only: tab, filter, selection, reply drafts. It never derives inbox state itself; every transition is a command answered by the next snapshot. |

## Purpose

Owns the Inbox page with its Inbox and Activity tabs, the thread and activity rows, the thread detail with the agent's read and the reply composer, the sidebar entry with its unread badge, the needs-you toasts, the window title count and the inbox push kind in the service worker. Non-goals: it does not decide verdicts, does not call a source tool, and does not persist anything beyond the pane layout.

## Governance

| Reference | Type | Governs | Precedence | Notes |
| --- | --- | --- | --- | --- |
| ref-zustand-store | ref | View state lives in inboxStore with stable selectors; no useState in components | Mandatory | Day labels use the snapshot time recorded in the store so render stays pure. |
| ref-ws-subscription | ref | The inbox topic is read once through the global subscription in useAppGlobalState; every control sends a typed command and waits for the next snapshot | Mandatory | Send, instruct, archive, mark-read and load-older render pending state through runPendingAction and usePendingAction. |
| ref-strong-typing | ref | Snapshots and command acks are typed from src/shared/inbox and src/shared/protocol; the raw payload is JsonValue rendered as a fenced block | Mandatory | The inbox.page ack is typed by inboxPageSchema in src/shared/inbox/types.schema.ts, so the store takes it without narrowing. |
| rule-zustand-store | rule | Transitions such as select, setTab, setFilter and the reply drafts are named store actions, never inline JSX updaters | Mandatory | The page reads selectors and calls actions through useInboxStore.getState(). |

## Contract

| Surface | Direction | Contract | Boundary | Evidence |
| --- | --- | --- | --- | --- |
| /inbox and /inbox/:threadId | IN | One page tab of kind inbox; the thread id rides the tab path and reaches the page as a prop | A persisted inbox tab whose path no longer resolves is dropped on rehydrate | src/client/lib/paneTree/pageTabs.ts |
| Inbox and Activity tabs | OUT | Inbox shows threads in new, needs_you or fyi plus attention items, unread first and grouped by day; Activity shows every record newest first with source, attention, project and chat filters and Load older through inbox.page | Filters apply to the Activity tab only | src/client/lib/inboxFilter.ts |
| Thread detail | IN/OUT | Opening a thread sends inbox.markRead; Send sends inbox.reply with the composer text, Instruct sends inbox.instruct, Archive sends inbox.archive; Send and Instruct are disabled with a hint when the thread has no handler chat | The draft is seeded from the agent's report and edited locally; Discard clears only the local draft | src/client/app/InboxReplyComposer.tsx |
| needs-you signals | OUT | A thread entering needs_you raises at most three toasts per snapshot plus one overflow toast when not on /inbox, counts in the sidebar badge and the window title, and sends a push of kind inbox unless the source handler disabled push | State is drawn with the four marks, never colour alone | src/client/app/useInboxToasts.ts |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| public/sw.js inbox case | c3-126 Contract | Wording is free; the tag must fall back from threadId to chatId | public/sw.js |
| CLAUDE.md Inbox section | c3-126 Contract | Wording is free; the needs_you-only signal rule must survive | CLAUDE.md |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A toast fires for every snapshot instead of a new needs_you thread | Dropping the known-id diff in useInboxToasts | The toast test replays the same snapshot twice and expects one toast | bun test --conditions production src/client/app/useInboxToasts.test.tsx |
| Send runs while the thread has no handler chat | Removing the chatId guard in the composer | The composer test asserts the disabled state and its hint | bun test --conditions production src/client/app/InboxReplyComposer.test.tsx |
| The Inbox page lands in the entry bundle | Replacing the lazy import in PageTabContent | check:bundle reports the entry over budget | bun test --conditions production src/ops/architecture/budget.test.ts |
| A selector returns a fresh array each render | Inline fallbacks in inboxStore selectors | The store test asserts EMPTY identity | bun test --conditions production src/client/stores/inboxStore.test.ts |
