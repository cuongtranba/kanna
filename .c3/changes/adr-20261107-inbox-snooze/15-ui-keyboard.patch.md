---
target: c3-126
scope: block
base: c3-126#n11995@v1:sha256:f888dfe1581142ba6acb920c90691a067863ac795803ff83d265a3f801617198
---
| Keyboard | IN | useInboxKeyboard maps the keybinding actions inboxNextThread j, inboxPrevThread k, inboxFocusComposer r, inboxArchiveThread e, inboxApproveProposal a, inboxToggleUnread u, inboxToggleSelect x, inboxSnoozeThread h, inboxCloseThread Escape, inboxFocusSearch slash and inboxShowShortcuts question mark to the next or previous listed thread, the composer, archive, approve, mark read or unread, checking the open thread, opening the snooze menu, clearing the checked threads or else closing the thread, the search box and the shortcuts dialog; archive, approve and read changes go through lib/inboxActions.ts like the buttons | A bare key never fires while an input, textarea, select or contenteditable has focus; Escape does nothing when an open layer already handled it; a: nothing happens unless the open thread has an open proposal; h: nothing happens unless the open thread can be snoozed | src/client/app/useInboxKeyboard.ts |
