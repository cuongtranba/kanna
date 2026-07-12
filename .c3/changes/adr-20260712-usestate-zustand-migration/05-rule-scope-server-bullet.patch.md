---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8584@v1:sha256:032da4e5522cd3fa726e8bc5cbeb7b6f4aa41497d5c80ea4b142127a7203a7e6
---
Free-form storage of server snapshots — chats/projects/messages/status arrive over WebSocket into the single WS-fed `kannaStateStore` (written only by the `useKannaState` socket pipeline); feature and scoped stores must not hold copies
