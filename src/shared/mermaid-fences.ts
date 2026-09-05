
export interface MermaidFence {
  source: string
  startLine: number
}

export const MERMAID_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*mermaid[ \t]*$/i

export const MERMAID_FENCE_END_REGEX = /^[ \t]*`{3,}[ \t]*$/

export function closingFenceRegex(fenceLength: number): RegExp {
  return new RegExp(`^[ \\t]*\`{${String(fenceLength)},}[ \\t]*$`)
}

export interface FenceBody {
  source: string
  lastLineIndex: number
}

export function scanFenceBody(
  lines: readonly string[],
  startLineIndex: number,
  fence: string,
): FenceBody {
  const endRegex = closingFenceRegex(fence.length)
  const bodyLines: string[] = []
  let lastLineIndex = startLineIndex

  for (let i = startLineIndex + 1; i < lines.length; i++) {
    const line = lines[i]
    if (line === undefined) break
    lastLineIndex = i
    if (endRegex.test(line)) break
    bodyLines.push(line)
  }

  return { source: bodyLines.join("\n"), lastLineIndex }
}

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
