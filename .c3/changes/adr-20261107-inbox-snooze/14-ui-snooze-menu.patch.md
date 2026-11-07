---
target: c3-126
scope: insert
base: c3-126#n11996@v1:sha256:c1bebc2b0fe158936ee3ceb2a2789fdb6b5ac1a458389e9e68b2b717206d6999
---
| Snooze menu | IN/OUT | A popover in the thread header and the bulk bar offers Later today (three hours from now), Tomorrow (9:00 the next day), Next week (9:00 next Monday) and Pick a time, a datetime-local input that must lie in the future; a choice sends one inbox.snooze with the chosen threadIds and until, closes the open thread or clears the selection, and shows a Snoozed until toast whose Undo sends inbox.unsnooze for each thread | The presets and the labels are computed once when the menu opens, so what is shown is what is sent; only a new, needs\_you or fyi thread offers Snooze; open state and the picked time live in inboxStore so the key and the buttons share them | src/client/app/InboxSnoozeMenu.tsx |
