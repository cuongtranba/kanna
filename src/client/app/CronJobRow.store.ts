import { createScopedStore } from "../lib/createScopedStore"

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
