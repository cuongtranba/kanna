import { noteTabActivated } from "../components/panes/paneRetention"
import type { OpenLocalLinkTarget } from "../components/messages/shared"
import { createScopedStore } from "../lib/createScopedStore"

/**
 * Per-pane ephemeral state.
 *
 * Replaces the six slices of the singleton chatPageStore that need independent
 * instances per pane (one for the chat pane, one for the changes pane, one per
 * terminal pane). The singleton chatPageStore retains the slices that genuinely
 * belong to a single ChatPage instance (empty-state typing, file drag, scroll
 * position, etc.).
 *
 * Six per-pane slices (mirroring their chatPageStore counterparts exactly so
 * consumers can be migrated file-by-file without any behavioural change):
 *
 *   toolGroupExpanded   — ChatTranscriptViewport accordion state
 *   inputHeight         — transcript padding-bottom
 *   layoutWidth         — pane container width (right-sidebar size clamping)
 *   fixedTerminalHeight — TerminalWorkspaceShell height snapshot
 *   localLinkMenuTarget — local-link context-menu target
 *   diffRenderMode      — git changes render mode (+ wrapDiffLines)
 *
 * `void` init — no configuration needed at mount time; all defaults are
 * hard-coded (same pattern as TerminalPane.store.ts).
 */

interface PaneScopedState {
  // ─── Tool group expanded ───────────────────────────────────────────────────
  toolGroupExpanded: Record<string, boolean>
  setToolGroupExpanded: (
    updater: (current: Record<string, boolean>) => Record<string, boolean>,
  ) => void
  resetToolGroupExpanded: () => void

  // ─── Input height (transcript padding-bottom) ─────────────────────────────
  inputHeight: number
  setInputHeight: (height: number) => void

  // ─── Layout / container width ─────────────────────────────────────────────
  layoutWidth: number
  setLayoutWidth: (width: number) => void

  // ─── Fixed terminal height ────────────────────────────────────────────────
  fixedTerminalHeight: number
  setFixedTerminalHeight: (height: number) => void

  // ─── Local link menu target ───────────────────────────────────────────────
  localLinkMenuTarget: OpenLocalLinkTarget | null
  setLocalLinkMenuTarget: (target: OpenLocalLinkTarget | null) => void
  /** Drive the local-link context menu: closing (open=false) clears the target. */
  setLocalLinkMenuOpen: (open: boolean) => void

  // ─── Diff render mode + wrap lines ────────────────────────────────────────
  diffRenderMode: "unified" | "split"
  wrapDiffLines: boolean
  setDiffRenderMode: (mode: "unified" | "split") => void
  setWrapDiffLines: (wrap: boolean) => void

  // ─── Tab retention ────────────────────────────────────────────────────────
  /** Most-recently-activated tab ids first; drives which tabs stay mounted. */
  tabRecency: readonly string[]
  /** Named transition — the previous value is derived inside the store. */
  noteTabActivated: (tabId: string) => void
}

export const PaneScopedStore = createScopedStore<void, PaneScopedState>(
  "PaneScoped",
  () => (set) => ({
    // Tool group expanded
    toolGroupExpanded: {},
    setToolGroupExpanded: (updater) =>
      set((state) => ({ toolGroupExpanded: updater(state.toolGroupExpanded) })),
    resetToolGroupExpanded: () => set({ toolGroupExpanded: {} }),

    // Input height
    inputHeight: 148,
    setInputHeight: (height) => set({ inputHeight: height }),

    // Layout width
    layoutWidth: 0,
    setLayoutWidth: (width) => set({ layoutWidth: width }),

    // Fixed terminal height
    fixedTerminalHeight: 0,
    setFixedTerminalHeight: (height) => set({ fixedTerminalHeight: height }),

    // Local link menu target
    localLinkMenuTarget: null,
    setLocalLinkMenuTarget: (target) => set({ localLinkMenuTarget: target }),
    setLocalLinkMenuOpen: (open) =>
      set((state) =>
        open || state.localLinkMenuTarget === null ? state : { localLinkMenuTarget: null },
      ),

    // Diff render mode + wrap lines
    diffRenderMode: "unified",
    wrapDiffLines: false,
    setDiffRenderMode: (mode) => set({ diffRenderMode: mode }),
    setWrapDiffLines: (wrap) => set({ wrapDiffLines: wrap }),

    // Tab retention
    tabRecency: [],
    noteTabActivated: (tabId) =>
      set((state) => {
        const next = noteTabActivated(state.tabRecency, tabId)
        // Same reference means "already most recent" — skip the write so
        // re-activating the current tab cannot publish a new snapshot.
        return next === state.tabRecency ? state : { tabRecency: next }
      }),
  }),
)
