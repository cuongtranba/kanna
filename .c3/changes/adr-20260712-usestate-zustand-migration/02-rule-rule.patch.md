---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8565@v1:sha256:3b054bc631d2b68ac67524d88ede50ff91b29d2b4088dfbf27fde9a5c929c1b1
---
Client state stores take exactly two forms. (1) Singleton feature stores: `create<TState>()` from `zustand`, at `src/client/stores/<concern>(Store)?.ts`, exposing a single hook (`use<Concern>Store`). (2) Per-instance scoped stores (component rendered N times): `createScopedStore(displayName, createState)` from `src/client/lib/createScopedStore.tsx`, colocated as `<Component>.store.ts` next to the component, subtree wrapped in the returned `Provider`. Persist only via `zustand/middleware`'s `persist` — never custom `localStorage` writes. Selectors returning collections must return stable references (module-level `EMPTY` constant or `useShallow`) — never inline `?? []` / `?? {}` (React error #185). New `React.useState` outside the frozen allowlist fails `bun run lint:usestate`.
