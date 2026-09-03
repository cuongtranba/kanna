import { createScopedStore } from "../lib/createScopedStore"

/** Whether this row's edit dialog is open. One instance per rendered row. */
export interface CronJobRowState {
  editing: boolean
  openEditor: () => void
  setEditing: (editing: boolean) => void
}

export const CronJobRowStore = createScopedStore<void, CronJobRowState>(
  "CronJobRow",
  () => (set) => ({
    editing: false,
    openEditor: () => set({ editing: true }),
    setEditing: (editing) => set({ editing }),
  }),
)
