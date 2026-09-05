import { createContext, useContext, useMemo, type ReactNode } from "react"

export interface TranscriptRenderOptions {
  readonly: boolean
  localLinkMode: "open" | "text"
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
