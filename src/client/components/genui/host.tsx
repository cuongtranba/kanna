import { createContext, useContext, type ComponentType, type ReactNode } from "react"
import type { DatasetDecl, DatasetQuery, DatasetQueryOutcome } from "../../../shared/genui"
import type { ChartRendererProps } from "./charts/chart-renderer"

export interface GenUIHost {
  chatId: string | null
  readonly: boolean
  workspaceRoot: string | null
  queryDataset: ((decl: DatasetDecl, query: DatasetQuery, refresh: boolean) => Promise<DatasetQueryOutcome>) | null
  approveTool: ((server: string, tool: string) => Promise<void>) | null
  sendToAgent: ((message: string) => Promise<void>) | null
  openLink: (url: string) => void
  ChartRenderer: ComponentType<ChartRendererProps> | null
}

export const READONLY_GENUI_HOST: GenUIHost = {
  chatId: null,
  readonly: true,
  workspaceRoot: null,
  queryDataset: null,
  approveTool: null,
  sendToAgent: null,
  openLink: () => {},
  ChartRenderer: null,
}

const GenUIHostContext = createContext<GenUIHost>(READONLY_GENUI_HOST)

export function GenUIHostProvider({ value, children }: { value: GenUIHost; children: ReactNode }) {
  return <GenUIHostContext.Provider value={value}>{children}</GenUIHostContext.Provider>
}

export function useGenUIHost(): GenUIHost {
  return useContext(GenUIHostContext)
}
