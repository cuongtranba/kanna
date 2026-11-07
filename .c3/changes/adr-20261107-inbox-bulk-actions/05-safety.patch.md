---
target: c3-247
scope: insert
---
| Undo of an archive restores the wrong state, or mark unread is undone by opening the thread | Restoring a fixed state instead of the remembered one, or dropping the keep-unread hold on the open thread | The registry test restores needs\_you, new and replied threads with their unread flag after a restart, and the keyboard test keeps a thread unread while it stays open | bun run test src/server/inbox/inbox-registry.test.ts src/client/app/InboxKeyboard.test.tsx |
