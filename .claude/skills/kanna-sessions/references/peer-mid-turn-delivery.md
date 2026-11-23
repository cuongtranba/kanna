# A peer message can enter a running turn, and is still released on consumption

A queued message with a `peer_chat` origin may also be pushed INTO the running
turn (`src/server/peer-messaging/mid-turn-delivery.ts`). The queue stays the
record; the release moves to the provider's consumption signal:

- Claude: `startClaudeSession` always passes `--replay-user-messages`, so the
  CLI echoes each stdin user message, with the uuid the host gave it, at the
  moment it is consumed. `injectPrompt(queuedId, wrapped)` pushes with the
  queued id as uuid; the echo surfaces as the `prompt_delivered` harness event,
  which appends the `user_prompt` entry and releases the message. Echoes of
  Kanna's own turn prompts carry no tracked id and are ignored.
- A folded message produces NO extra `result`, so `pendingPromptSeqs` stays one
  per Kanna send. A message the CLI could not fold runs as its own turn after
  the result; its echo arrives before any assistant entry and is ADOPTED as a
  normal ActiveTurn (`recordTurnStarted`, `beginPrompt`) so its result settles
  through the usual path. Until the echo, `injectedPromptIds` makes `isChatBusy`
  true, or the post-result drain would start a different queued message first.
- `q.interrupt()` leaves pushed-but-unconsumed messages queued in the CLI, so
  `cancelChat` closes a session that still holds one; they stay queued in
  Kanna, preserving "Stop starts no queued message". An injection never echoed
  returns to the queue 15 s after the turn's result.
- Codex: `turn/steer` always consumes the input in the same turn, so success
  records and releases at once.

See `adr-20261114-peer-messages-reach-a-running-turn`.
