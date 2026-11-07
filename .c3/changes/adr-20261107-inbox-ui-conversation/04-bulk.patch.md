---
target: c3-126
scope: insert
base: c3-126#n11934@v1:sha256:3bd3893e1f23715444e0b866cf5836a065162c2b27d7f24975e4f365ffa8a2bf
---
| Bulk selection | IN/OUT | Each thread row has a checkbox; while any thread is checked a bar shows the count with Mark read (inbox.markRead), Mark unread (inbox.markUnread), Archive (one inbox.archive with threadIds, then an Undo toast that sends inbox.unarchive for each) and Clear | Activity items cannot be checked; a checked thread that leaves the visible list is unchecked | src/client/app/InboxBulkBar.tsx |
