---
target: c3-247
scope: insert
base: c3-247#n14476@v1:sha256:059b47fa4fd4cf3adc0429a4164ced61aa6d1f9dd85ae20a7bfe5d53376d84cb
---
| Read, archive and message text | IN/OUT | inbox\_thread\_read carries an optional read flag, absent meaning read, and markUnread records read false; the projection remembers each thread state and unread flag at archive time and inbox\_thread\_unarchived restores exactly that; an inbound message keeps its full text, computed once on ingest and kept only when it differs from the preview | A muted or archived thread stays read when marked unread; unarchive of a thread that is not archived does nothing; a new message or a trim ends the remembered archive state; older logs without the flag or the text replay unchanged | src/server/inbox/inbox-projection.ts |
