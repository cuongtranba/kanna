import { createScopedStore } from "../../lib/createScopedStore"

type ProbeState = "idle" | "ready" | "missing"

interface OfferDownloadMessageState {
  probeState: ProbeState
  previewOpen: boolean
  setProbeState: (probeState: ProbeState) => void
  setPreviewOpen: (previewOpen: boolean) => void
}

export const OfferDownloadMessageStore = createScopedStore<void, OfferDownloadMessageState>(
  "OfferDownloadMessage",
  () => (set) => ({
    probeState: "idle",
    previewOpen: false,
    setProbeState: (probeState) => set({ probeState }),
    setPreviewOpen: (previewOpen) => set({ previewOpen }),
  }),
)
