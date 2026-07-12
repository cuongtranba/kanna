---
id: rule-zustand-store
c3-seal: d45b04f2981cd37ca9120723d14497d987618b1246f53630b8c3a80d9d95b87a
title: zustand-store
type: rule
goal: All client state in Kanna lives in Zustand stores. Singleton feature state lives under `src/client/stores/<concern>Store.ts` (one concern per file, colocated `<concern>Store.test.ts`); per-instance component state lives in a colocated `<Component>.store.ts` built with `createScopedStore` from `src/client/lib/createScopedStore.tsx`. Server-derived truth lives ONLY in the WS-fed `kannaStateStore`, written exclusively by the `useKannaState` socket pipeline. Raw `useState` outside the frozen allowlist fails the `no-react-usestate` ast-grep CI gate (`bun run lint:usestate`).
---

# zustand-store

## Goal

All client state in Kanna lives in Zustand stores. Singleton feature state lives under `src/client/stores/<concern>Store.ts` (one concern per file, colocated `<concern>Store.test.ts`); per-instance component state lives in a colocated `<Component>.store.ts` built with `createScopedStore` from `src/client/lib/createScopedStore.tsx`. Server-derived truth lives ONLY in the WS-fed `kannaStateStore`, written exclusively by the `useKannaState` socket pipeline. Raw `useState` outside the frozen allowlist fails the `no-react-usestate` ast-grep CI gate (`bun run lint:usestate`).

## Rule

Client state stores take exactly two forms. (1) Singleton feature stores: `create<TState>()` from `zustand`, at `src/client/stores/<concern>(Store)?.ts`, exposing a single hook (`use<Concern>Store`). (2) Per-instance scoped stores (component rendered N times): `createScopedStore(displayName, createState)` from `src/client/lib/createScopedStore.tsx`, colocated as `<Component>.store.ts` next to the component, subtree wrapped in the returned `Provider`. Persist only via `zustand/middleware`'s `persist` — never custom `localStorage` writes. Selectors returning collections must return stable references (module-level `EMPTY` constant or `useShallow`) — never inline `?? []` / `?? {}` (React error #185). New `React.useState` outside the frozen allowlist fails `bun run lint:usestate`.

## Golden Example

```ts
// src/client/stores/preferences.ts
import { create } from "zustand"                                // REQUIRED: zustand create import
import { persist } from "zustand/middleware"                    // REQUIRED for persisted stores; OPTIONAL otherwise

interface PreferencesState {                                    // REQUIRED: named state interface
  autoResumeOnRateLimit: boolean
  setAutoResumeOnRateLimit: (value: boolean) => void            // REQUIRED: setters live in the state shape
}

interface PersistedPreferencesState {                            // REQUIRED when persist() is used: separate shape for migrate()
  autoResumeOnRateLimit?: boolean
}

function migratePreferencesState(                                // REQUIRED when version > 0
  persistedState: Partial<PersistedPreferencesState> | undefined,
): Pick<PreferencesState, "autoResumeOnRateLimit"> {
  return {
    autoResumeOnRateLimit: Boolean(persistedState?.autoResumeOnRateLimit),
  }
}

export const usePreferencesStore = create<PreferencesState>()(   // REQUIRED: single exported hook named use<Concern>Store
  persist(
    (set) => ({
      autoResumeOnRateLimit: false,
      setAutoResumeOnRateLimit: (value) => set({ autoResumeOnRateLimit: value }),
    }),
    {
      name: "kanna-preferences",                                  // REQUIRED: stable storage key
      version: 1,
      migrate: (persistedState) => migratePreferencesState(
        persistedState as Partial<PersistedPreferencesState> | undefined,
      ),
    },
  ),
)
```

File: `src/client/stores/preferences.ts` (colocated test: `src/client/stores/preferences.test.ts`).

## Not This

| Anti-Pattern | Correct | Why Wrong Here |
| --- | --- | --- |
| React.createContext + provider for UI state | create<TState>() Zustand store | Adds provider tree, breaks selector ergonomics, makes testing harder |
| useState lifted into App for cross-route state | Zustand store in src/client/stores/ | Re-renders entire subtree; routes lose isolation |
| Feature store holds its own copy of a server snapshot (chats: ChatSnapshot[]) | Server snapshots live only in the WS-fed kannaStateStore, written by the useKannaState socket pipeline | Two sources of truth diverge; socket reconnect overwrites the copy mid-edit |
| localStorage.setItem("foo", ...) directly in store | persist middleware with name: key | Custom writes bypass schema versioning + migrate; reload corrupts state |
| Singleton store file at src/client/app/myStore.ts | src/client/stores/myStore.ts for singletons; colocated <Component>.store.ts via createScopedStore for per-instance state | Singleton stores outside stores/ break the directory contract; only createScopedStore stores may colocate with their component |

## Scope

**Applies to:**

- All UI-local state for the client app: chat input, preferences, sidebar collapse, terminal layout, sound prefs, slash-command picker state, etc.
- Both persisted (`persist`) and ephemeral (no middleware) stores

**Does NOT apply to:**

- Free-form storage of server snapshots — chats/projects/messages/status arrive over WebSocket into the single WS-fed `kannaStateStore` (written only by the `useKannaState` socket pipeline); feature and scoped stores must not hold copies
- The frozen `useState` allowlist — client tests (`src/client/**/*.test.ts(x)`), `src/client/components/ui/**` primitives, and the fixed hooks `useIsMobile`, `useNow`, `useStickyState`, `useTheme`, `useIsStandalone` — where `useState` remains correct; everywhere else new `useState` fails the `no-react-usestate` ast-grep gate

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-zustand-store
3. Name the exact concern and why a non-Zustand container is needed
