import { createScopedStore } from "../../../../lib/createScopedStore"
import type { TablePreviewData } from "../../attachmentPreview"

export type TableBodyState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; table: TablePreviewData; truncated: boolean }

interface TableBodyStoreState {
  state: TableBodyState
  setState: (state: TableBodyState) => void
}

export const TableBodyStore = createScopedStore<{ initialState: TableBodyState }, TableBodyStoreState>(
  "TableBody",
  (init) => (set) => ({
    state: init.initialState,
    setState: (state) => set({ state }),
  }),
)
