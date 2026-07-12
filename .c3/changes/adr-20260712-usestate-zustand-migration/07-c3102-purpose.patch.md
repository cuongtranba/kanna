---
target: c3-102
scope: block
base: c3-102#n5456@v1:sha256:541ad17cae23c9d9538307ac470651a88185c16d64eb5e56f445e59e65ea2d97
---
Owns the browser-side state surface as Zustand stores in three forms: singleton per-concern stores (chat input, sidebar order, terminal layout, preferences) with selective `persist` middleware, the WS-fed `kannaStateStore` holding server snapshots (written exclusively by the `useKannaState` socket pipeline), and the `createScopedStore` factory (`src/client/lib/createScopedStore.tsx`) backing per-instance stores colocated as `<Component>.store.ts` beside their components. Raw `useState` is banned outside the frozen allowlist by the `no-react-usestate` ast-grep gate. Non-goals: route state and derived render caches — those live elsewhere.
