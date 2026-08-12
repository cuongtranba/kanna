---
target: c3-112
scope: block
base: c3-112#n7864@v1:sha256:96459637a0b121526bc3f54d713cd6bbfef7686152817064ecff2e7b91ee0068
---
Composes the workspace route: transcript viewport, input dock, embedded terminal panel, focus/scroll policy, sidebar action wiring, and the pure context the tab strip titles and statuses tabs from. Route-neutral — /chat/:chatId and /boards/:projectId/:boardId mount the same page and differ only in which tab the route param opens. Non-goals: rendering individual entries, owning input state, terminal PTY logic, and what a non-chat tab renders.
