import { createContext, useContext, type ReactNode } from "react"
import type { GenUISpec } from "../../../shared/genui"

export interface GenUIViewContextValue {
  spec: GenUISpec
  viewKey: string
}

const GenUIViewContext = createContext<GenUIViewContextValue | null>(null)

export function GenUIViewContextProvider({ value, children }: { value: GenUIViewContextValue; children: ReactNode }) {
  return <GenUIViewContext.Provider value={value}>{children}</GenUIViewContext.Provider>
}

export function useGenUIView(): GenUIViewContextValue {
  const value = useContext(GenUIViewContext)
  if (!value) throw new Error("GenUI components render only inside a GenUI view")
  return value
}
