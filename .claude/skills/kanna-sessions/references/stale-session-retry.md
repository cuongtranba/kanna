# A resume that finds no conversation retries once on a fresh session

Claude Code deletes its session files after `cleanupPeriodDays` (30 by default),
so a chat idle longer than that holds a token for a conversation that no longer
exists. Resuming it ends at once with `error_during_execution` and
`No conversation found with session ID`, before the model runs. A peer message is
the usual trigger, because it lands on chats nobody has opened in weeks.

`startTurnForChat` gives a Claude SDK turn that resumes a token a
`retryOnFreshSession` closure on its `ActiveTurn`. When `settleFailedTurn` sees the
missing conversation and the closure exists, it discards the session (the provider
token and `pendingForkSessionToken`), records no `turn_failed`, and returns
`retry_on_fresh_session`. The runner then calls the closure instead of draining the
queue (on a thrown error, at the end of `finally`). The retry reuses the turn's
arguments with `appendUserPrompt: false`, so the `user_prompt` is not written twice,
and a null token makes `shouldInjectPrimer` prime the new session with the
history. It cannot loop: the retried turn has no token, so it gets no closure.
Prompt-too-long still fails the turn and discards the session as before.
