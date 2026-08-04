import { createContext, useContext, useMemo, type ReactNode } from "react"

export interface TranscriptRenderOptions {
  readonly: boolean
  localLinkMode: "open" | "text"
  /**
   * Where the actionable AskUserQuestion card lives.
   *
   * "footer" degrades the inline transcript row to a non-actionable pointer so
   * there is exactly one place to answer — the footer pinned above the
   * composer. Mirrors SubagentMessage's `suppressPendingTool`.
   */
  askUserQuestionSurface: "inline" | "footer"
}

const DEFAULT_RENDER_OPTIONS: TranscriptRenderOptions = {
  readonly: false,
  localLinkMode: "open",
  askUserQuestionSurface: "inline",
}

const TranscriptRenderOptionsContext = createContext<TranscriptRenderOptions>(DEFAULT_RENDER_OPTIONS)

export function TranscriptRenderOptionsProvider({
  children,
  value,
}: {
  children: ReactNode
  value: Partial<TranscriptRenderOptions>
}) {
  // Memoized: spreading inline published a fresh object on every render, which
  // re-rendered every consumer and is exactly the render-loop shape the
  // project's stable-reference rule bans. Callers should pass a stable `value`
  // (module-level const or useMemo) for this to bite.
  const merged = useMemo(
    () => ({ ...DEFAULT_RENDER_OPTIONS, ...value }),
    [value],
  )
  return (
    <TranscriptRenderOptionsContext.Provider value={merged}>
      {children}
    </TranscriptRenderOptionsContext.Provider>
  )
}

export function useTranscriptRenderOptions() {
  return useContext(TranscriptRenderOptionsContext)
}
