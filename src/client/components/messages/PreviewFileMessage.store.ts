import { createScopedStore } from "../../lib/createScopedStore"

type ProbeState = "idle" | "ready" | "missing"

interface PreviewFileMessageState {
  probeState: ProbeState
  previewOpen: boolean
  setProbeState: (probeState: ProbeState) => void
  setPreviewOpen: (previewOpen: boolean) => void
}

export const PreviewFileMessageStore = createScopedStore<void, PreviewFileMessageState>(
  "PreviewFileMessage",
  () => (set) => ({
    probeState: "idle",
    previewOpen: false,
    setProbeState: (probeState) => set({ probeState }),
    setPreviewOpen: (previewOpen) => set({ previewOpen }),
  }),
)
