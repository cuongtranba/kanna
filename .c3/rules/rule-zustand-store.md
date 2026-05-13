---
id: rule-zustand-store
c3-seal: 211b6f01a30b45b1c9a6d95fbcb70a1f4ce6fba9ef3b4e801b839960e2c3cf10
title: zustand-store
type: rule
goal: All client UI-local state in Kanna lives in small Zustand stores under `src/client/stores/<concern>Store.ts`, one concern per file, with a colocated `<concern>Store.test.ts`. Server-derived truth must NOT live in a Zustand store — it lives in the WebSocket-backed `useKannaState` hook.
---

# zustand-store

## Goal

All client UI-local state in Kanna lives in small Zustand stores under `src/client/stores/<concern>Store.ts`, one concern per file, with a colocated `<concern>Store.test.ts`. Server-derived truth must NOT live in a Zustand store — it lives in the WebSocket-backed `useKannaState` hook.

## Rule

All client UI-state stores must use `create<TState>()` from `zustand`, live at `src/client/stores/<concern>(Store)?.ts`, expose a single hook (`use<Concern>Store`), and persist only via `zustand/middleware`'s `persist` — never via custom `localStorage` writes.

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
| Store holds server snapshot (chats: ChatSnapshot[]) | Server state stays in useKannaState hook (WS-backed) | Two sources of truth diverge; socket reconnect overwrites store mid-edit |
| localStorage.setItem("foo", ...) directly in store | persist middleware with name: key | Custom writes bypass schema versioning + migrate; reload corrupts state |
| Store file at src/client/app/myStore.ts | src/client/stores/myStore.ts | Breaks the single-directory contract; lookup + audit cannot find it |

## Scope

**Applies to:**

- All UI-local state for the client app: chat input, preferences, sidebar collapse, terminal layout, sound prefs, slash-command picker state, etc.
- Both persisted (`persist`) and ephemeral (no middleware) stores

**Does NOT apply to:**

- Server snapshots (chats, projects, messages, status) — these arrive over WebSocket and live in the `useKannaState` hook, not a store
- Component-local state that never crosses a single component boundary — `useState` is correct there

## Override

To deviate:

1. Document in an ADR `Compliance Rules` row with action `override` and a repo-specific reason
2. Cite rule-zustand-store
3. Name the exact concern and why a non-Zustand container is needed
