---
target: c3-247
scope: block
base: c3-247#n14454@v1:sha256:69f0c587b9d2459ff15e7d9d5b271901b683ddf5bbb73cbf30102b46fd2f2b0b
---
| Autopilot | IN/OUT | An auto decision stores the proposal as scheduled with scheduledFor and arms an in-memory timer through an injected clock; on fire it re-checks that the proposal is still scheduled and the thread is neither paused nor muted, sends by agent with the proposal id, confidence and reason, and resolves it sent; cancelProposal is Undo and clears the timer | Fire and Undo race on an in-memory claim so exactly one wins; the claim is not taken in the registry write lane because the outbox flush runs inside it; a new inbound message or a newer proposal expires the open or scheduled proposal; a muted thread counts as paused | src/server/inbox/inbox-autopilot.ts |
