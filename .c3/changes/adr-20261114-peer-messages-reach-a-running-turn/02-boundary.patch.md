---
target: c3-249
scope: block
base: c3-249#n14767@v1:sha256:cef37303b7f9d59357049ba1b0ae53384ea76242600330ebdbf56b6ca53a7eab
---
| Boundary | Owns delivery rules, guardrails, idle subscriptions, waits and mid-turn delivery. It does not own queue or transcript state: it enqueues through AgentCoordinator, lets the normal queue start an idle chat's turn, and releases a queued message only when the provider confirms it consumed it. |
