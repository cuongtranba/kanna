---
target: c3-247
scope: insert
base: c3-247#n14459@v1:sha256:5cc197ff60e611504e9ad91a030206108f37a2cb07be8795de7f814bd0de1eaf
---
| Sender mute | IN/OUT | inbox\_sender\_muted with sourceKind, sourceId, sender and muted adds or removes the sender key; every thread with that key carries muted, which new threads inherit; a muted thread stays read, leaves the Inbox tab and never fires onNeedsYou | The key is the display sender, so two senders sharing a name on one source share a mute; compaction keeps every mute event; unmute never replays the muted messages | src/server/inbox/inbox-projection.ts |
