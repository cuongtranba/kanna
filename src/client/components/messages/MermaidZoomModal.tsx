import { useEffect, type PointerEvent as ReactPointerEvent } from "react"
import { createPortal } from "react-dom"
import { Minus, Plus, RotateCcw, X } from "lucide-react"
import { Button } from "../ui/button"
import { MermaidZoomModalStore } from "./MermaidZoomModal.store"
import type { DomPort } from "../../ports"
import { domAdapter } from "../../adapters"

interface Props {
  svg: string
  onClose: () => void
  ports?: { dom?: DomPort }
}

function MermaidZoomModalInner({ svg, onClose, ports }: Props) {
  const dom = ports?.dom ?? domAdapter
  const scale = MermaidZoomModalStore.useScopedStore((s) => s.scale)
  const offset = MermaidZoomModalStore.useScopedStore((s) => s.offset)
  const zoomIn = MermaidZoomModalStore.useScopedStore((s) => s.zoomIn)
  const zoomOut = MermaidZoomModalStore.useScopedStore((s) => s.zoomOut)
  const resetView = MermaidZoomModalStore.useScopedStore((s) => s.resetView)
  const beginDrag = MermaidZoomModalStore.useScopedStore((s) => s.beginDrag)
  const dragTo = MermaidZoomModalStore.useScopedStore((s) => s.dragTo)
  const endDrag = MermaidZoomModalStore.useScopedStore((s) => s.endDrag)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose() }
    return dom.addWindowListener("keydown", onKey)
  }, [onClose, dom])

  const onPointerDown = (e: ReactPointerEvent) => beginDrag(e.clientX, e.clientY)
  const onPointerMove = (e: ReactPointerEvent) => dragTo(e.clientX, e.clientY)

  return createPortal(
    <div
      className="fixed inset-0 z-[100] flex flex-col bg-background/95"
      role="dialog"
      aria-modal="true"
      aria-label="Diagram zoom view"
    >
      <div className="flex justify-end gap-1 p-2">
        <Button variant="ghost" size="icon" aria-label="Zoom out"
          className="h-9 w-9" onClick={zoomOut}>
          <Minus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Zoom in"
          className="h-9 w-9" onClick={zoomIn}>
          <Plus className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Reset view"
          className="h-9 w-9" onClick={resetView}>
          <RotateCcw className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="icon" aria-label="Close"
          className="h-9 w-9" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div
        className="flex-1 overflow-hidden touch-none cursor-grab active:cursor-grabbing"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerLeave={endDrag}
      >
        <div
          data-mermaid-stage
          className="w-full h-full flex items-center justify-center"
          style={{ transform: `translate(${offset.x}px, ${offset.y}px) scale(${scale})` }}
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      </div>
    </div>,
    dom.getBodyElement()
  )
}

export function MermaidZoomModal({ svg, onClose, ports }: Props) {
  return (
    <MermaidZoomModalStore.Provider init={undefined}>
      <MermaidZoomModalInner svg={svg} onClose={onClose} ports={ports} />
    </MermaidZoomModalStore.Provider>
  )
}
