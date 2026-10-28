import { scanFenceBody } from "./markdown-fences"

export interface MermaidFence {
  source: string
  startLine: number
}

export const MERMAID_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*mermaid[ \t]*$/i

export function extractMermaidFences(markdown: string): readonly MermaidFence[] {
  const lines = markdown.split("\n")
  const fences: MermaidFence[] = []

  let index = 0
  while (index < lines.length) {
    const line = lines[index] ?? ""
    const start = MERMAID_FENCE_START_REGEX.exec(line)
    if (!start) {
      index += 1
      continue
    }
    const body = scanFenceBody(lines, index, start[1] ?? "```")
    fences.push({ source: body.source, startLine: index + 1 })
    index = body.lastLineIndex + 1
  }

  return fences
}
