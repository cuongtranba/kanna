import { useCallback, useEffect, useId } from "react"
import { Check, Code2, Copy, Maximize2 } from "lucide-react"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { useTheme } from "../../hooks/useTheme"
import { MermaidFallbackCodeBlock } from "./shared"
import { MermaidZoomModal } from "./MermaidZoomModal"
import { MermaidDiagramStore } from "./MermaidDiagram.store"

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
    mermaidPromise = import("mermaid").then((m): MermaidModule => m.default)
  }
  return mermaidPromise
}

function MermaidDiagramInner({ source }: { source: string }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme: "dark" | "default" = resolvedTheme === "dark" ? "dark" : "default"
  const renderState = MermaidDiagramStore.useScopedStore((s) => s.renderState)
  const showSource = MermaidDiagramStore.useScopedStore((s) => s.showSource)
  const zoomOpen = MermaidDiagramStore.useScopedStore((s) => s.zoomOpen)
  const copied = MermaidDiagramStore.useScopedStore((s) => s.copied)
  const setRenderState = MermaidDiagramStore.useScopedStore((s) => s.setRenderState)
  const setShowSource = MermaidDiagramStore.useScopedStore((s) => s.setShowSource)
  const setZoomOpen = MermaidDiagramStore.useScopedStore((s) => s.setZoomOpen)
  const setCopied = MermaidDiagramStore.useScopedStore((s) => s.setCopied)
  const rawId = useId()
  const domId = `mermaid-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`

  const closeZoom = useCallback(() => setZoomOpen(false), [setZoomOpen])

  const handleCopy = async () => {
    await navigator.clipboard.writeText(source)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  useEffect(() => {
    let cancelled = false
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: mermaidTheme,
        })
        const { svg } = await mermaid.render(domId, source)
        if (!cancelled) setRenderState({ status: "ready", svg })
      })
      .catch(() => {
        if (!cancelled) setRenderState({ status: "error" })
      })
    return () => {
      cancelled = true
    }
  }, [source, mermaidTheme, domId, setRenderState])

  if (renderState.status === "error") {
    return <MermaidFallbackCodeBlock source={source} />
  }
  if (renderState.status === "loading") {
    return (
      <div className="relative group/mermaid">
        <MermaidFallbackCodeBlock source={source} />
      </div>
    )
  }

  if (showSource) {
    return (
      <div className="relative group/mermaid">
        <MermaidFallbackCodeBlock source={source} />
        <MermaidControls
          showSource={showSource}
          onToggleSource={() => setShowSource(!showSource)}
          onCopy={handleCopy}
          copied={copied}
          onZoom={undefined}
        />
      </div>
    )
  }

  return (
    <div className="relative group/mermaid my-3">
      <div
        className="flex justify-center overflow-x-auto"
        dangerouslySetInnerHTML={{ __html: renderState.svg }}
      />
      <MermaidControls
        showSource={showSource}
        onToggleSource={() => setShowSource(!showSource)}
        onCopy={handleCopy}
        copied={copied}
        onZoom={() => setZoomOpen(true)}
      />
      {zoomOpen && (
        <MermaidZoomModal svg={renderState.svg} onClose={closeZoom} />
      )}
    </div>
  )
}

export function MermaidDiagram({ source }: { source: string }) {
  return (
    <MermaidDiagramStore.Provider init={undefined}>
      <MermaidDiagramInner source={source} />
    </MermaidDiagramStore.Provider>
  )
}

function MermaidControls({
  showSource,
  onToggleSource,
  onCopy,
  copied,
  onZoom,
}: {
  showSource: boolean
  onToggleSource: () => void
  onCopy: () => void
  copied: boolean
  onZoom?: () => void
}) {
  return (
    <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-100 md:opacity-0 md:group-hover/mermaid:opacity-100 transition-opacity [@media(hover:none)]:!opacity-100">
      {onZoom && !showSource && (
        <Button
          variant="ghost"
          size="icon"
          aria-label="Zoom diagram"
          className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
          onClick={onZoom}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      )}
      <Button
        variant="ghost"
        size="icon"
        aria-label={showSource ? "View rendered diagram" : "View diagram source"}
        className="h-8 w-8 rounded-md text-muted-foreground hover:text-foreground"
        onClick={onToggleSource}
      >
        <Code2 className="h-4 w-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        aria-label={copied ? "Copied" : "Copy diagram source"}
        className={cn(
          "h-8 w-8 rounded-md text-muted-foreground",
          !copied && "hover:text-foreground",
          copied && "hover:!bg-transparent"
        )}
        onClick={onCopy}
      >
        {copied ? <Check className="h-4 w-4 text-success" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
