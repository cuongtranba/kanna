import { createScopedStore } from "../../lib/createScopedStore"
import type { FileProbeResult } from "../../api/files"

export type ProbedFileState = FileProbeResult | { kind: "loading" }

interface ProbedFileCardState {
  probe: ProbedFileState
  previewOpen: boolean
  setProbe: (probe: ProbedFileState) => void
  setPreviewOpen: (previewOpen: boolean) => void
}

export const ProbedFileCardStore = createScopedStore<void, ProbedFileCardState>(
  "ProbedFileCard",
  () => (set) => ({
    probe: { kind: "loading" },
    previewOpen: false,
    setProbe: (probe) => set({ probe }),
    setPreviewOpen: (previewOpen) => set({ previewOpen }),
  }),
)
