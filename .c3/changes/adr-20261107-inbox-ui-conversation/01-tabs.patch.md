---
target: c3-126
scope: block
base: c3-126#n11926@v1:sha256:1b47571eafd5da08aff02fd4e0286a5b28201f60ccf9ba1d484caf4d684d68c0
---
| Inbox and Activity tabs | OUT | Inbox shows threads in new, needs\_you or fyi plus attention items, with unread records first in an Unread group and the rest grouped by day newest first, narrowed by the quick filters All, Needs you, FYI and Unread with counts; Activity shows every record newest first by day with source, attention, project and chat filters and Load older through inbox.page; a search box narrows both tabs to records whose sender, source, summary, title or preview contains the text; a skeleton shows until the first snapshot arrives | Quick filters apply to the Inbox tab and the source filters to Activity; each day label appears once; search reads only loaded records | src/client/lib/inboxFilter.ts |
