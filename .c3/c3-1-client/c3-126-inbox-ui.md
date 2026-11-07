---
id: c3-126
c3-seal: c3e23fdb531e1d761283b2f9f2e3af2ccfb65e1d30b7b84851dd77acf6c59d6b
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
| Consumers | c3-247 inbox serves the inbox topic and the twelve inbox commands; c3-244 push-notifications sends the inbox push kind; c3-110 app-shell mounts the routes, the title count and the toast hook; c3-104 pane tabs hold the inbox page kind. |
| Boundary | Owns presentation and local view state only: tab, filter, selection, reply drafts. It never derives inbox state itself; every transition is a command answered by the next snapshot. |

## Purpose

Owns the Inbox page with its Inbox and Activity tabs, the thread and activity rows, the thread detail with the agent's read, the messages in both directions and the reply composer, the sidebar entry with its unread badge, the needs-you toasts, the window title count and the inbox push kind in the service worker. Non-goals: it does not decide verdicts, does not call a source tool or resend a message itself, and does not persist anything beyond the pane layout.

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
| Inbox and Activity tabs | OUT | Inbox shows threads in new, needs\_you or fyi plus attention items, with unread records first in an Unread group and the rest grouped by day newest first, narrowed by the quick filters All, Needs you, FYI and Unread with counts; Activity shows every record newest first by day with source, attention, project and chat filters and Load older through inbox.page; a search box narrows both tabs to records whose sender, source, summary, title or preview contains the text; a skeleton shows until the first snapshot arrives | Quick filters apply to the Inbox tab and the source filters to Activity; each day label appears once; search reads only loaded records | src/client/lib/inboxFilter.ts |
| Thread detail | IN/OUT | The thread reads as a conversation: inbound messages on the left with their full text, else the preview, and outbound rows on the right; the agent read card sits above the proposal card and the composer; a sticky header holds the sender, source, state, Open chat, previous and next, Mark unread and Archive, which sends inbox.archive and offers Undo through inbox.unarchive; opening a thread sends inbox.markRead unless the user marked it unread while it is open; Send sends inbox.reply with the composer text and Enter sends it too unless Shift, Cmd or Ctrl is held or an input method is composing, Ask agent sends inbox.instruct with the text as the instruction and is also triggered by Cmd or Ctrl plus Enter and by Enter on text starting with a slash, quick prompts send a canned instruction plus the current draft, draft chips load an earlier draft, Mute sender sends inbox.muteSender; the reply mode is direct when the thread's MCP source has a reply target (button reads Send, works in Notify), agent when only a handler chat exists (button reads Agent will send) and none otherwise, where the composer is disabled with a hint; Ask agent and quick prompts always need a handler chat and a thread that is not archived | The box shows the typed text, else the newest thread draft unless it was dismissed; Send, Ask and Discard dismiss the newest draft so it does not return and a newer one seeds; on a narrow screen the detail covers the list | src/client/app/InboxThreadDetail.tsx |
| Outbound rows | IN/OUT | What you sent is shown in the thread between the messages that arrived, ordered by time, with Sending, Sent, Failed with its reason or Not confirmed; Retry sends inbox.retrySend, and a Not confirmed row first shows a warning that the message may be delivered twice and sends confirmDuplicate only after Send again | A newer outbound message replaces the summary in the thread row preview as You followed by its text until the sender writes again | src/client/app/InboxOutboundEntry.tsx |
| Autonomy controls | IN/OUT | The thread header of an MCP thread offers a dropdown of Source default, Off, Suggest, Approve and Auto that sends inbox.setThreadAutonomy (null for the source default); Approve and Auto are disabled with a hint when the source has no reply target and Auto also when the handler provider is Codex; an Agent paused chip with Resume (inbox.resumeAgent) shows while agentPausedUntil is in the future; Allow auto for this contact appears when the effective level is auto and the thread key is not allowlisted and writes the source autonomy.allowlist through the mcpSources settings patch | Webhook threads have no controls; the pause chip and countdown read the shared one-second clock hook | src/client/app/InboxAutonomyControls.tsx |
| Proposal card | IN/OUT | An open proposal shows its text, confidence, reason and blockedBy with Send (inbox.approveProposal), Edit (loads the text into the composer through setReplyDraft) and Reject (inbox.rejectProposal); a scheduled one shows Sending in m:ss counted from scheduledFor with Undo (inbox.cancelProposal) | Editing sends nothing; the proposal resolves rejected when the edited text is sent as a direct reply, which the server takes as a takeover | src/client/app/InboxProposalCard.tsx |
| Keyboard | IN | useInboxKeyboard maps the keybinding actions inboxNextThread j, inboxPrevThread k, inboxFocusComposer r, inboxArchiveThread e, inboxApproveProposal a, inboxToggleUnread u, inboxToggleSelect x, inboxCloseThread Escape, inboxFocusSearch slash and inboxShowShortcuts question mark to the next or previous listed thread, the composer, archive, approve, mark read or unread, checking the open thread, clearing the checked threads or else closing the thread, the search box and the shortcuts dialog; archive, approve and read changes go through lib/inboxActions.ts like the buttons | A bare key never fires while an input, textarea, select or contenteditable has focus; Escape does nothing when an open layer already handled it; a: nothing happens unless the open thread has an open proposal | src/client/app/useInboxKeyboard.ts |
| Outbound labels | OUT | Each outbound row reads You, You · approved or Agent · auto; a row with proposal provenance shows its confidence and reason in the project Tooltip | Never a native title | src/client/app/InboxOutboundEntry.tsx |
| Sent by agent filter | OUT | A filter chip sets InboxFilter.sentByAgent; the shared inboxThreadMatchesFilter keeps threads with any agent outbound and drops activity items | The matcher is shared with the server registry so the two cannot drift | src/client/lib/inboxFilter.ts |
| needs-you signals | OUT | A thread entering needs_you raises at most three toasts per snapshot plus one overflow toast when not on /inbox, counts in the sidebar badge and the window title, and sends a push of kind inbox unless the source handler disabled push | State is drawn with the four marks, never colour alone | src/client/app/useInboxToasts.ts |
| Bulk selection | IN/OUT | Each thread row has a checkbox; while any thread is checked a bar shows the count with Mark read (inbox.markRead), Mark unread (inbox.markUnread), Archive (one inbox.archive with threadIds, then an Undo toast that sends inbox.unarchive for each) and Clear | Activity items cannot be checked; a checked thread that leaves the visible list is unchecked | src/client/app/InboxBulkBar.tsx |

## Derived Materials

| Material | Must derive from | Allowed variance | Evidence |
| --- | --- | --- | --- |
| public/sw.js inbox case | c3-126 Contract | Wording is free; the tag must fall back from threadId to chatId | public/sw.js, public/sw-notifications.js |
| CLAUDE.md Inbox section | c3-126 Contract | Wording is free; the needs_you-only signal rule must survive | CLAUDE.md |

## Change Safety

| Risk | Trigger | Detection | Required Verification |
| --- | --- | --- | --- |
| A toast fires for every snapshot instead of a new needs_you thread | Dropping the known-id diff in useInboxToasts | The toast test replays the same snapshot twice and expects one toast | bun test --conditions production src/client/app/useInboxToasts.test.tsx |
| Send runs while the thread has no way to reply | Removing the reply mode guard in the composer | The composer test asserts the disabled state and its hint, and that a Notify thread with a reply target is enabled | bun run test src/client/app/InboxReplyComposer.test.tsx |
| An unconfirmed message is retried without the duplicate warning | Sending confirmDuplicate from the first Retry click | The thread detail test expects no command until Send again is pressed | bun run test src/client/app/InboxThreadDetail.test.tsx |
| Enter sends while an input method is composing | Dropping the isComposing and keyCode checks | The composer test presses Enter while composing and expects no command | bun run test src/client/app/InboxReplyComposer.test.tsx |
| The Inbox page lands in the entry bundle | Replacing the lazy import in PageTabContent | check:bundle reports the entry over budget | bun test --conditions production src/ops/architecture/budget.test.ts |
| Auto is offered where the server would refuse it | Letting the dropdown enable Auto for a Codex handler or a source without a reply target | The autonomy test expects Auto disabled with the reason for both | bun run test src/client/app/InboxAutonomy.test.tsx |
| A scheduled auto-send cannot be undone from the card | Hiding Undo once the countdown reaches zero or dropping the cancelProposal command | The autonomy test expects Undo to send inbox.cancelProposal | bun run test src/client/app/InboxAutonomy.test.tsx |
| A shortcut fires while the reply box has focus | Dropping the typing guard in resolveBoundCommand | The keyboard test presses every inbox key inside the composer and expects no selection change and no command | bun run test src/client/app/InboxKeyboard.test.tsx |
| A selector returns a fresh array each render | Inline fallbacks in inboxStore selectors | The store test asserts EMPTY identity | bun test --conditions production src/client/stores/inboxStore.test.ts |
