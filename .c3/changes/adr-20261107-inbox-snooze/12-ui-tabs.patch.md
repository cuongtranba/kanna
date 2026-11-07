---
target: c3-126
scope: block
base: c3-126#n11990@v1:sha256:46625dfddd6342c76a288f7de911dc1a8ce2ec0aad27e65f5f737d2c7944ac1f
---
| Inbox and Activity tabs | OUT | Inbox shows threads in new, needs\_you or fyi plus attention items, with unread records first in an Unread group and the rest grouped by day newest first, narrowed by the quick filters All, Needs you, FYI, Unread and Snoozed with counts, where a snoozed thread is hidden from every filter but Snoozed and shows Until its wake time in place of its state mark; Activity shows every record newest first by day with source, attention, project and chat filters and Load older through inbox.page; a search box narrows both tabs to records whose sender, source, summary, title or preview contains the text; a skeleton shows until the first snapshot arrives | Quick filters apply to the Inbox tab and the source filters to Activity; each day label appears once; search reads only loaded records | src/client/lib/inboxFilter.ts |
