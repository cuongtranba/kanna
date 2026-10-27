import { createContext, useContext, useRef, type ReactNode } from "react"
import { createStore, useStore, type StateCreator, type StoreApi } from "zustand"

export interface ScopedStore<TProps, TState> {
  Provider: (props: { init: TProps; children: ReactNode }) => ReactNode
  useScopedStore: <TSelected>(selector: (state: TState) => TSelected) => TSelected
  useScopedStoreApi: () => StoreApi<TState>
}

export function createScopedStore<TProps, TState>(
  displayName: string,
  createState: (init: TProps) => StateCreator<TState>
): ScopedStore<TProps, TState> {
  const Context = createContext<StoreApi<TState> | null>(null)

  function Provider({ init, children }: { init: TProps; children: ReactNode }) {
    const storeRef = useRef<StoreApi<TState> | null>(null)
    // oxlint-disable react-hooks/refs -- lazy one-time init of a ref-held store; the compiler-based ESLint rule allowed this pattern, the native rule flags it
    if (storeRef.current === null) {
      storeRef.current = createStore<TState>(createState(init))
    }
    return <Context.Provider value={storeRef.current}>{children}</Context.Provider>
    // oxlint-enable react-hooks/refs
  }

  function useScopedStoreApi(): StoreApi<TState> {
    const store = useContext(Context)
    if (store === null) {
      throw new Error(`${displayName}: useScopedStore must be used inside its Provider`)
    }
    return store
  }

  function useScopedStore<TSelected>(selector: (state: TState) => TSelected): TSelected {
    return useStore(useScopedStoreApi(), selector)
  }

  return { Provider, useScopedStore, useScopedStoreApi }
}
