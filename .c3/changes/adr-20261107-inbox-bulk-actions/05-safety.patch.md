---
target: c3-247
scope: insert
base: c3-247#n14492@v1:sha256:5e7a8e5fe9d8dcb064c2ea5725cd69cf08afba2e406327e3a49e55d5f0f71b91
---
| Undo of an archive restores the wrong state, or mark unread is undone by opening the thread | Restoring a fixed state instead of the remembered one, or dropping the keep-unread hold on the open thread | The registry test restores needs\_you, new and replied threads with their unread flag after a restart, and the keyboard test keeps a thread unread while it stays open | bun run test src/server/inbox/inbox-registry.test.ts src/client/app/InboxKeyboard.test.tsx |
