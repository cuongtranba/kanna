---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n9059@v1:sha256:32def6afa6b75b254116eb0bbd2baf8f39850999c7c08b0e21412ab585b23623
---
All client state in Kanna lives in Zustand stores, and so does every transition of it. Singleton feature state lives under `src/client/stores/<concern>Store.ts` (one concern per file, colocated `<concern>Store.test.ts`); per-instance component state lives in a colocated `<Component>.store.ts` built with `createScopedStore` from `src/client/lib/createScopedStore.tsx`. Stores expose named intent actions (`toggleStackExpanded`, `closeStackPanel`), never updater-shaped passthrough setters. Server-derived truth lives ONLY in the WS-fed `kannaStateStore`, written exclusively by the `useKannaState` socket pipeline. Raw `useState` outside the frozen allowlist fails the `no-react-usestate` ast-grep CI gate, and state-transition logic written inline in a JSX attribute fails the `no-jsx-inline-state-logic` / `no-jsx-inline-state-updater` gates (all via `bun run lint:usestate`).
