import { useDroppable } from "@dnd-kit/core"
import { Fragment, type ReactNode, useCallback, useMemo } from "react"
import type { Layout } from "react-resizable-panels"
import {
  isGroup,
  type PaneGroup,
  type PaneLayout,
  type PaneLeaf,
  type PaneNode,
  type SplitPosition,
} from "../../lib/paneTree"
import { cn } from "../../lib/utils"
import { isMobileViewport } from "../../lib/viewport"
import { usePaneDragStore } from "../../stores/paneDragStore"
import { useViewportStore } from "../../stores/viewportStore"
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from "../ui/resizable"
import { flattenLayoutForMobile } from "./mobileLayout"
import type { PaneDropIntent } from "./paneDropGeometry"


export interface SplitContainerProps {
  layout: PaneLayout
  renderPane: (pane: PaneLeaf, isFocused: boolean) => ReactNode
  onFocusPane: (paneId: string) => void
  onResizeGroup: (groupId: string, sizes: number[]) => void
}

function toPercent(fraction: number): string {
  return `${fraction * 100}%`
}

interface NodeViewProps extends Omit<SplitContainerProps, "layout"> {
  node: PaneNode
  focusedPaneId: string | null
}

function GroupView({ node, ...rest }: NodeViewProps & { node: PaneGroup }) {
  const { onResizeGroup } = rest

  const handleLayoutChanged = useCallback(
    (next: Layout) => {
      const sizes = node.children.map((child) => (next[child.id] ?? 0) / 100)
      if (sizes.some((size) => size > 0)) onResizeGroup(node.id, sizes)
    },
    [node.children, node.id, onResizeGroup],
  )

  return (
    <ResizablePanelGroup
      orientation={node.direction}
      className="min-h-0 min-w-0"
      onLayoutChanged={handleLayoutChanged}
    >
      {node.children.map((child, index) => (
        <Fragment key={child.id}>
          <ResizablePanel
            id={child.id}
            defaultSize={toPercent(node.sizes[index] ?? 1 / node.children.length)}
            className="min-h-0 min-w-0"
          >
            <NodeView {...rest} node={child} />
          </ResizablePanel>
          {index < node.children.length - 1 ? (
            <ResizableHandle withHandle orientation={node.direction} />
          ) : null}
        </Fragment>
      ))}
    </ResizablePanelGroup>
  )
}

function PaneView({ node, focusedPaneId, renderPane, onFocusPane }: NodeViewProps & { node: PaneLeaf }) {
  const isFocused = focusedPaneId === node.id
  const handleFocus = useCallback(() => onFocusPane(node.id), [node.id, onFocusPane])

  const { setNodeRef } = useDroppable({ id: node.id })
  const isDropTarget = usePaneDragStore((state) => state.overPaneId === node.id)
  const intent = usePaneDragStore((state) => state.intent)

  return (
    <div
      ref={setNodeRef}
      data-pane-id={node.id}
      data-pane-focused={isFocused ? "true" : "false"}
      className={cn("relative flex h-full min-h-0 min-w-0 flex-col overflow-hidden")}
      onPointerDownCapture={handleFocus}
    >
      {renderPane(node, isFocused)}
      {isDropTarget && intent ? <PaneDropIndicator intent={intent} /> : null}
    </div>
  )
}

const DROP_ZONE_CLASS: Record<SplitPosition, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
}

function PaneDropIndicator({ intent }: { intent: PaneDropIntent }) {
  return (
    <div
      aria-hidden="true"
      data-pane-drop={intent.kind === "merge" ? "merge" : `split-${intent.position}`}
      className={cn(
        "pointer-events-none absolute z-10 border border-destructive bg-destructive/[0.08]",
        intent.kind === "merge" ? "inset-0" : DROP_ZONE_CLASS[intent.position],
      )}
    />
  )
}

function NodeView(props: NodeViewProps) {
  return isGroup(props.node) ? (
    <GroupView {...props} node={props.node} />
  ) : (
    <PaneView {...props} node={props.node} />
  )
}

export function SplitContainer({ layout, ...rest }: SplitContainerProps) {
  const viewportWidth = useViewportStore((state) => state.width)

  const mobilePane = useMemo(
    () => (isMobileViewport(viewportWidth) ? flattenLayoutForMobile(layout) : null),
    [viewportWidth, layout],
  )

  if (mobilePane) {
    return (
      <div data-pane-mobile="true" className="flex h-full min-h-0 min-w-0 flex-col">
        <NodeView {...rest} node={mobilePane} focusedPaneId={mobilePane.id} />
      </div>
    )
  }

  return <NodeView {...rest} node={layout.root} focusedPaneId={layout.focusedPaneId} />
}
