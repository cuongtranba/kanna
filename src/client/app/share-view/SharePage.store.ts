import { createScopedStore } from "../../lib/createScopedStore"
import type { ChatSnapshot, ShareError } from "../../../shared/session-share/types"

type LoadState =
  | { kind: "loading" }
  | { kind: "ok"; snapshot: ChatSnapshot }
  | { kind: "error"; error: ShareError; status: number }

interface SharePageState {
  loadState: LoadState
  setLoadState: (loadState: LoadState) => void
}

export const SharePageStore = createScopedStore<Record<string, never>, SharePageState>(
  "SharePage",
  () => (set) => ({
    loadState: { kind: "loading" },
    setLoadState: (loadState) => set({ loadState }),
  }),
)
