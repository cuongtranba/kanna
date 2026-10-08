---
target: c3-227
scope: block
base: c3-227#n12149@v1:sha256:20818ee76ad353d0471d32308fcbcb2fc1e706a2524ef145af445fa75025303f
---
Owns the Kanna auto-continue feature: classifies a turn-ending `result`
event as `rate-limited` or `auth-error`, picks a retry time (provider
hint when present, fallback backoff otherwise), records an
`auto_continue_scheduled` event, sleeps until the wake-up, then replays
the queued user prompt by triggering a new turn on the same chat.
Non-goals: turn orchestration itself (c3-210), OAuth token rotation
(c3-224), Claude/Codex transport (c3-211 and the session code in c3-210). The scheduler never
mutates account state — token rotation stays in c3-224 — and never
writes a UI envelope directly; it pushes events that read-models
subscribe to and the WS router fans out.
