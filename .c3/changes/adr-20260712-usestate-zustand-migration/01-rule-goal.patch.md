---
target: rule-zustand-store
scope: block
base: rule-zustand-store#n8563@v1:sha256:04d2547c3c157058d5365f335e1a0339b99175e45379ac5e01765491e5b03a80
---
All client state in Kanna lives in Zustand stores. Singleton feature state lives under `src/client/stores/<concern>Store.ts` (one concern per file, colocated `<concern>Store.test.ts`); per-instance component state lives in a colocated `<Component>.store.ts` built with `createScopedStore` from `src/client/lib/createScopedStore.tsx`. Server-derived truth lives ONLY in the WS-fed `kannaStateStore`, written exclusively by the `useKannaState` socket pipeline. Raw `useState` outside the frozen allowlist fails the `no-react-usestate` ast-grep CI gate (`bun run lint:usestate`).
