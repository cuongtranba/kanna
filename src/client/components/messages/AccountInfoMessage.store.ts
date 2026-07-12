import { createScopedStore } from "../../lib/createScopedStore"

interface AccountInfoMessageState {
  expanded: boolean
  setExpanded: (expanded: boolean) => void
}

export const AccountInfoMessageStore = createScopedStore<void, AccountInfoMessageState>(
  "AccountInfoMessage",
  () => (set) => ({
    expanded: false,
    setExpanded: (expanded) => set({ expanded }),
  }),
)
