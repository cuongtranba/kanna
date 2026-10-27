import { MermaidDiagram } from "../../MermaidDiagram"
import { useTextBodyContent } from "./textLoader"
import { TextBodyFrame } from "./TextBodyFrame"
import type { PreviewSource } from "../types"

export function MermaidBody({ source }: { source: PreviewSource }) {
  const state = useTextBodyContent(source)
  return (
    <TextBodyFrame state={state} shell={<div className="hidden" />} readyClassName="p-4">
      {(content) => <MermaidDiagram source={content} />}
    </TextBodyFrame>
  )
}
