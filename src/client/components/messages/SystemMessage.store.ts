import { createScopedStore } from "../../lib/createScopedStore"

interface OpenState {
  open: boolean
  setOpen: (open: boolean) => void
}

const makeOpenStore = (displayName: string) =>
  createScopedStore<void, OpenState>(
    displayName,
    () => (set) => ({
      open: false,
      setOpen: (open) => set({ open }),
    }),
  )

export const CollapsibleSectionStore = makeOpenStore("CollapsibleSection")
export const ExpandableMcpServerStore = makeOpenStore("ExpandableMcpServer")
export const RawMessageSectionStore = makeOpenStore("RawMessageSection")
