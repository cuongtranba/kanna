---
target: c3-126
scope: block
base: c3-126#n11998@v1:sha256:3bd3893e1f23715444e0b866cf5836a065162c2b27d7f24975e4f365ffa8a2bf
---
| needs-you signals | OUT | A thread entering needs_you, or waking from a snooze while in needs_you, raises at most three toasts per snapshot plus one overflow toast when not on /inbox, counts in the sidebar badge and the window title, and sends a push of kind inbox unless the source handler disabled push | State is drawn with the four marks, never colour alone; a snoozed thread is not newly needing you until it wakes, through the same raisesNotification rule as the server | src/client/app/useInboxToasts.ts |
