import { createScopedStore } from "../../lib/createScopedStore"

type ProbeState =
  | { kind: "loading" }
  | { kind: "ready"; mimeType: string; size: number }
  | { kind: "missing" }
  | { kind: "error" }

interface LocalFileLinkCardState {
  probe: ProbeState
  previewOpen: boolean
  setProbe: (probe: ProbeState) => void
  setPreviewOpen: (previewOpen: boolean) => void
}

export const LocalFileLinkCardStore = createScopedStore<void, LocalFileLinkCardState>(
  "LocalFileLinkCard",
  () => (set) => ({
    probe: { kind: "loading" },
    previewOpen: false,
    setProbe: (probe) => set({ probe }),
    setPreviewOpen: (previewOpen) => set({ previewOpen }),
  }),
)
