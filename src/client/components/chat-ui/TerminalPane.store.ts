import type { TerminalSnapshot } from "../../../shared/protocol"
import { createScopedStore } from "../../lib/createScopedStore"

type TerminalMetadata = Pick<TerminalSnapshot, "cwd" | "shell" | "status" | "exitCode">

interface TerminalPaneState {
  metadata: TerminalMetadata | null
  error: string | null
  setMetadata: (next: TerminalMetadata | null) => void
  setMetadataConditional: (next: TerminalMetadata) => void
  setMetadataFromExit: (exitCode: number) => void
  setError: (error: string | null) => void
  resetTerminal: () => void
}

export const TerminalPaneStore = createScopedStore<void, TerminalPaneState>(
  "TerminalPane",
  () => (set) => ({
    metadata: null,
    error: null,
    setMetadata: (next) => set({ metadata: next }),
    setMetadataConditional: (next) => set((state) => {
      const m = state.metadata
      if (
        m !== null &&
        m.cwd === next.cwd &&
        m.shell === next.shell &&
        m.status === next.status &&
        m.exitCode === next.exitCode
      ) {
        return {}
      }
      return { metadata: next }
    }),
    setMetadataFromExit: (exitCode) => set((state) => ({
      metadata: {
        cwd: state.metadata?.cwd ?? "",
        shell: state.metadata?.shell ?? "",
        status: "exited",
        exitCode,
      },
    })),
    setError: (error) => set({ error }),
    resetTerminal: () => set({ metadata: null, error: null }),
  }),
)
