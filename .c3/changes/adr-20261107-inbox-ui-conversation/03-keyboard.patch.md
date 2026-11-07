---
target: c3-126
scope: block
base: c3-126#n11931@v1:sha256:9fe79da599d03168cc1a9d13c4bd2994172235ed07ea889ad6894f58a2df4019
---
| Keyboard | IN | useInboxKeyboard maps the keybinding actions inboxNextThread j, inboxPrevThread k, inboxFocusComposer r, inboxArchiveThread e, inboxApproveProposal a, inboxToggleUnread u, inboxToggleSelect x, inboxCloseThread Escape, inboxFocusSearch slash and inboxShowShortcuts question mark to the next or previous listed thread, the composer, archive, approve, mark read or unread, checking the open thread, clearing the checked threads or else closing the thread, the search box and the shortcuts dialog; archive, approve and read changes go through lib/inboxActions.ts like the buttons | A bare key never fires while an input, textarea, select or contenteditable has focus; Escape does nothing when an open layer already handled it; a: nothing happens unless the open thread has an open proposal | src/client/app/useInboxKeyboard.ts |
