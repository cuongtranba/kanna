# Read state, archive, Undo and message text

`inbox_thread_read` carries an optional `read` (absent means read, so old logs replay unchanged);
`inbox.markUnread` records `read: false`, and a muted or archived thread stays
read. `inbox.archive` takes `threadId` or `threadIds` (both optional, merged
and de-duplicated by the router), so remote callers sending `threadId` keep
working. The projection remembers each thread's state and unread flag at
archive time (`archivedFrom`, rebuilt on replay, dropped when a new message or
a trim ends the archive) and `inbox_thread_unarchived` restores exactly that;
`inbox.unarchive` on a thread that is not archived is a no-op. An
`InboundMessage.text` is the full text (`meta.text ?? payload`, capped at
`INBOX_MESSAGE_TEXT_MAX_CHARS`, kept only when it differs from `preview`),
computed once by `describeMessageText`; the bubble shows `text ?? preview`.
On the client, `keepUnreadId` stops the open-thread effect from re-marking a
thread read after you marked it unread, and clears when the selection changes;
`checked` is the bulk selection, pruned to the visible threads. Archive Undo is
a sonner toast raised by `archiveInboxThreads` through `InboxToastPort`.
