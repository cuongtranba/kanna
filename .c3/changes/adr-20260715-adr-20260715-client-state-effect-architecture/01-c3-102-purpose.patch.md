---
target: c3-102
scope: block
base: c3-102#n5621@v1:sha256:324ee15a62a3e694767ebfeba9949d385fc5a806fb2e9d7aa3811bba20abbb90
---
Owns the browser-side state surface as Zustand stores in three forms: singleton per-concern stores (chat input, sidebar order, terminal layout, preferences) with selective `persist` middleware, the WS-fed `kannaStateStore` holding server snapshots (written exclusively by the `useKannaState` socket pipeline), and the `createScopedStore` factory (`src/client/lib/createScopedStore.tsx`) backing per-instance stores colocated as `<Component>.store.ts` beside their components. Additionally owns the `socketStore` singleton (`src/client/stores/socketStore.ts`) for raw WebSocket transport state (readyState + sendMessage), written exclusively by `SocketBridge`, and the `queryClient` server-cache surface (`src/client/query/queryClient.ts`, React Query) used by Zustand actions for imperative HTTP cache access. Raw `useState` is banned outside the frozen allowlist by the `no-react-usestate` ast-grep gate. Non-goals: route state and derived render caches — those live elsewhere.
