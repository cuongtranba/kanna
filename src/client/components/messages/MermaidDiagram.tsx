import { useEffect, useId, useState } from "react"
import { useTheme } from "../../hooks/useTheme"
import { MermaidFallbackCodeBlock } from "./shared"

interface MermaidModule {
  initialize: (config: {
    startOnLoad: boolean
    securityLevel: "strict"
    theme: "dark" | "default"
  }) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

let mermaidPromise: Promise<MermaidModule> | null = null

function loadMermaid(): Promise<MermaidModule> {
  if (!mermaidPromise) {
    mermaidPromise = import("mermaid").then(
      (m) => (m as unknown as { default: MermaidModule }).default
    )
  }
  return mermaidPromise
}

type RenderState =
  | { status: "loading" }
  | { status: "ready"; svg: string }
  | { status: "error" }

export function MermaidDiagram({ source }: { source: string }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme: "dark" | "default" = resolvedTheme === "dark" ? "dark" : "default"
  const [state, setState] = useState<RenderState>({ status: "loading" })
  const rawId = useId()
  const domId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`

  useEffect(() => {
    let cancelled = false
    setState({ status: "loading" })
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: mermaidTheme,
        })
        const { svg } = await mermaid.render(domId, source)
        if (!cancelled) setState({ status: "ready", svg })
      })
      .catch(() => {
        if (!cancelled) setState({ status: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [source, mermaidTheme, domId])

  if (state.status === "error") {
    return <MermaidFallbackCodeBlock source={source} />
  }
  if (state.status === "loading") {
    return <MermaidFallbackCodeBlock source={source} />
  }
  return (
    <div
      className="my-3 flex justify-center overflow-x-auto"
      dangerouslySetInnerHTML={{ __html: state.svg }}
    />
  )
}
