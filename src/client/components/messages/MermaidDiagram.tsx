import { useCallback, useEffect, useId } from "react"
import { AlertTriangle, Check, Code2, Copy, Maximize2, RefreshCw, Wrench } from "lucide-react"
import { Button } from "../ui/button"
import { cn } from "../../lib/utils"
import { useTheme } from "../../hooks/useTheme"
import { MermaidFallbackCodeBlock } from "./shared"
import { MermaidZoomModal } from "./MermaidZoomModal"
import { MermaidDiagramStore } from "./MermaidDiagram.store"
import type { ClipboardPort } from "../../ports/clipboardPort"
import type { TimerPort } from "../../ports/timerPort"
import { clipboardAdapter } from "../../adapters/clipboard.adapter"
import { timerAdapter } from "../../adapters/timer.adapter"
import { domAdapter } from "../../adapters/dom.adapter"
import type { DomPort } from "../../ports/domPort"
import { toError } from "../../../shared/errors"
import { parseMermaidError } from "../../../shared/mermaidError"
import { repairMermaidSource, type MermaidRepair } from "../../../shared/mermaidRepair"
import { createLazyLoader, isStaleChunkError } from "../../../shared/lazyModule"

interface MermaidModule {
  initialize: (config: {
    startOnLoad: boolean
    securityLevel: "strict"
    theme: "dark" | "default"
  }) => void
  render: (id: string, text: string) => Promise<{ svg: string }>
}

interface MermaidDiagramPorts {
  clipboard?: ClipboardPort
  timer?: TimerPort
  dom?: DomPort
  loadMermaid?: () => Promise<MermaidModule>
}

const loadMermaid = createLazyLoader(() =>
  import("mermaid").then((m): MermaidModule => m.default)
)

async function renderWithRepair(
  mermaid: MermaidModule,
  domId: string,
  source: string,
): Promise<{ svg: string; repairs: readonly MermaidRepair[] }> {
  try {
    const { svg } = await mermaid.render(domId, source)
    return { svg, repairs: [] }
  } catch (firstError) {
    const repaired = repairMermaidSource(source)
    if (repaired.repairs.length === 0) throw firstError
    try {
      const { svg } = await mermaid.render(`${domId}-repaired`, repaired.source)
      return { svg, repairs: repaired.repairs }
    } catch {
      throw firstError
    }
  }
}

function describeRepairs(repairs: readonly MermaidRepair[]): string {
  const seen: string[] = []
  for (const repair of repairs) {
    const label = `${repair.from} → ${repair.to}`
    if (!seen.includes(label)) seen.push(label)
  }
  return seen.join(", ")
}

function MermaidDiagramInner({ source, ports }: { source: string; ports?: MermaidDiagramPorts }) {
  const { resolvedTheme } = useTheme()
  const mermaidTheme: "dark" | "default" = resolvedTheme === "dark" ? "dark" : "default"
  const renderState = MermaidDiagramStore.useScopedStore((s) => s.renderState)
  const errorMessage = renderState.status === "error" ? renderState.message : undefined
  const isStaleChunk = renderState.status === "error" && renderState.kind === "stale-chunk"
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
    await (ports?.clipboard ?? clipboardAdapter).writeText(source)
    setCopied(true)
    ;(ports?.timer ?? timerAdapter).setTimeout(() => setCopied(false), 2000)
  }

  const load = ports?.loadMermaid ?? loadMermaid

  useEffect(() => {
    let cancelled = false
    load()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: "strict",
          theme: mermaidTheme,
        })
        const { svg, repairs } = await renderWithRepair(mermaid, domId, source)
        if (!cancelled) setRenderState({ status: "ready", svg, repairs })
      })
      .catch((err) => {
        if (cancelled) return
        const error = toError(err)
        if (isStaleChunkError(error)) {
          setRenderState({ status: "error", kind: "stale-chunk" })
          return
        }
        setRenderState({ status: "error", message: error.message })
      })
    return () => {
      cancelled = true
    }
  }, [source, mermaidTheme, domId, setRenderState, load])

  if (isStaleChunk) {
    return (
      <div className="my-3">
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground mb-1">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>This diagram needs the latest version of the app.</span>
          <Button
            variant="ghost"
            size="sm"
            aria-label="Reload the app"
            className="h-6 px-2 text-xs"
            onClick={() => (ports?.dom ?? domAdapter).reload()}
          >
            <RefreshCw className="size-3 mr-1" />
            Reload
          </Button>
        </div>
        <MermaidFallbackCodeBlock source={source} />
      </div>
    )
  }
  if (renderState.status === "error") {
    const detail = parseMermaidError(errorMessage ?? "")
    return (
      <div className="my-3">
        <div className="flex items-start gap-1.5 text-xs text-destructive mb-1">
          <AlertTriangle className="size-3.5 shrink-0 mt-px" />
          <div className="min-w-0">
            <span>
              Couldn&apos;t render this Mermaid diagram
              {detail.line !== null ? (
                <span className="text-muted-foreground">
                  {" — line "}
                  <span className="tabular-nums">{detail.line}</span>
                </span>
              ) : null}
            </span>
            <div className="text-muted-foreground">{detail.summary}</div>
            {detail.excerpt ? (
              <pre className="mt-1 overflow-x-auto rounded-md border border-border bg-muted px-2 py-1 font-mono text-xs leading-snug whitespace-pre text-muted-foreground">
                {detail.excerpt}
              </pre>
            ) : null}
          </div>
        </div>
        <MermaidFallbackCodeBlock source={source} highlightLine={detail.line ?? undefined} />
      </div>
    )
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
      {renderState.repairs.length > 0 && (
        <div className="flex items-start gap-1.5 text-xs text-muted-foreground mb-1">
          <Wrench className="size-3.5 shrink-0 mt-px" />
          <span>
            {"Corrected "}
            <span className="tabular-nums">{renderState.repairs.length}</span>
            {renderState.repairs.length === 1 ? " invalid link" : " invalid links"}
            {" to render this ("}
            <span className="font-mono">{describeRepairs(renderState.repairs)}</span>
            {"). The source is unchanged."}
          </span>
        </div>
      )}
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

export function MermaidDiagram({ source, ports }: { source: string; ports?: MermaidDiagramPorts }) {
  return (
    <MermaidDiagramStore.Provider init={undefined}>
      <MermaidDiagramInner source={source} ports={ports} />
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
        {copied ? <Check className="h-4 w-4 text-success-text" /> : <Copy className="h-4 w-4" />}
      </Button>
    </div>
  )
}
