import type { TerminalSnapshot } from "../../../shared/protocol"
import { createScopedStore } from "../../lib/createScopedStore"

type TerminalMetadata = Pick<TerminalSnapshot, "cwd" | "shell" | "status" | "exitCode">

interface TerminalPaneState {
  metadata: TerminalMetadata | null
  error: string | null
  /** Direct set — use null to clear */
  setMetadata: (next: TerminalMetadata | null) => void
  /**
   * Conditional set: only updates if any of the four fields differ from the
   * current metadata (equivalent to the `sameTerminalMetadata` guard in the
   * old useState functional-update pattern).
   */
  setMetadataConditional: (next: TerminalMetadata) => void
  /**
   * Derives exit metadata from current state: keeps existing cwd/shell and
   * stamps status="exited" with the given exitCode.
   */
  setMetadataFromExit: (exitCode: number) => void
  setError: (error: string | null) => void
  /** Clears both metadata and error in one commit (used by clearVersion effect). */
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
