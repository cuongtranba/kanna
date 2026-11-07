# Snooze

`inbox_thread_snoozed { threadId, until }` sets `InboxThread.snoozedUntil` and
`inbox_thread_unsnoozed { threadId, reason }` clears it, with `reason` one of
`time`, `message` or `user`. Only a thread in an Inbox-tab state (`new`,
`needs_you`, `fyi`, via `isSnoozable`) can be snoozed; the projection ignores a
snooze on any other thread and the registry records nothing for it. `inboxTab`
excludes a snoozed thread, so it leaves All, Needs you, FYI and Unread, and
`unreadCount()` skips it, while its own `unread` flag is left alone.

A snooze never outlives the thread being snoozable: a new message
(`inbox_thread_message_added`), a report to `handled`, a reply, a sent outbound
and archiving all clear it in the projection. Ingesting a message into a snoozed
thread also records `inbox_thread_unsnoozed` with reason `message` first, so the
log and the bus (`kanna.inbox.unsnoozed`) show why. Waking by `time` marks the
thread unread unless its sender is muted; `message` and `user` leave `unread`
as it was.

`InboxRegistry.snooze(threadIds, until)` refuses an `until` that is not finite
or not after the registry clock with `{ ok: false, error }`, which
`ws-router-inbox.ts` turns into a command error. `unsnooze(threadId)` is the
`user` reason. `nextSnoozeWake()` and `wakeDueSnoozes()` are the whole timer
surface.

`startInboxSnoozeWaker` (`inbox-snooze-waker.ts`) reuses `AutopilotClock`. It
arms one timer for the earliest `snoozedUntil`, re-arms on every registry
change and after every wake (a timer that fires early finds nothing due and
arms again), clamps the delay to the 2^31-1 ms timer limit, and at start wakes
every snooze already due before arming the rest. `server.ts` starts it after
`wireInboxPush`, so a thread woken at boot reaches the push listener.

**Notification rule.** `raisesNotification` is `needs_you` and not snoozed.
`applyReport` and the waker both go through it, so a report that lands while the
thread sleeps stays silent and the wake raises `onNeedsYou` exactly once. The
client toast diff (`useInboxToasts`) uses the same predicate, so a snoozed
needs-you thread is not "newly needing you" until it wakes.

Client: `inboxSnooze.ts` holds the preset times (`snoozePresets`), the picked-time
parser and the label; `snoozeMenu`/`snoozeOpenedAt` in `inboxStore` own the open
menu so the `H` key and the buttons share it, and the presets are computed from
the time the menu opened so the label and the chosen time agree.
`snoozeInboxThreads` sends the command and raises the Undo toast through
`InboxToastPort`.
