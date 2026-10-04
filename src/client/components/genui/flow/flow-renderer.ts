import type { FlowLayout } from "./flow-layout"

export interface FlowRendererProps {
  layout: FlowLayout
  height: number
  label: string
  selectedId: string | null
  onSelect: (nodeId: string | null) => void
}
