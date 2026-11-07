---
target: c3-126
scope: block
base: c3-126#n11999@v1:sha256:3321a5eb0d7837a86eba644c18f9d7a89c4bba8a7bc87b5412245cbdcfd074eb
---
| Bulk selection | IN/OUT | Each thread row has a checkbox; while any thread is checked a bar shows the count with Mark read (inbox.markRead), Mark unread (inbox.markUnread), Snooze (the snooze menu), Archive (one inbox.archive with threadIds, then an Undo toast that sends inbox.unarchive for each) and Clear | Activity items cannot be checked; a checked thread that leaves the visible list is unchecked; on a touch screen the checkbox sits beside the avatar instead of over it | src/client/app/InboxBulkBar.tsx |
