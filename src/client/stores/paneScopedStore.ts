import { noteTabActivated } from "../components/panes/paneRetention"
import type { OpenLocalLinkTarget } from "../components/messages/shared"
import { createScopedStore } from "../lib/createScopedStore"

/**
 * Per-pane ephemeral state.
 *
 * Holds only the state that is genuinely per-PANE (shared across all tabs
 * inside one pane container):
 *
 *   layoutWidth         — pane container width (right-sidebar size clamping)
 *   localLinkMenuTarget — local-link context-menu target
 *   diffRenderMode      — git changes render mode (+ wrapDiffLines)
 *   tabRecency          — most-recently-activated tab ids (drives retention)
 *
 * State that is per-CHAT-TAB (independent for every tab mounted inside this
 * pane) was removed in chunk 0.8 and lives in ChatTabScopedStore:
 *   toolGroupExpanded, inputHeight, showScrollToBottom
 *
 * `void` init — no configuration needed at mount time; all defaults are
 * hard-coded (same pattern as TerminalPane.store.ts).
 */

interface PaneScopedState {
  // ─── Layout / container width ─────────────────────────────────────────────
  layoutWidth: number
  setLayoutWidth: (width: number) => void

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
    // Layout width
    layoutWidth: 0,
    setLayoutWidth: (width) => set({ layoutWidth: width }),

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
