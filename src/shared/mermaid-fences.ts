/**
 * The one definition of "a mermaid fence".
 *
 * Two consumers must agree byte-for-byte on where a diagram starts and ends:
 * the Lexical transformer that turns a fence into a `MermaidNode`, and the
 * server-side guard that validates what the model wrote. A second scanner
 * would eventually disagree with the first, and the disagreement would show up
 * as a diagram the guard cleared and the editor rendered differently.
 *
 * Pure — no DOM, no mermaid import.
 */

export interface MermaidFence {
  /** Fence body, delimiters excluded. */
  source: string
  /** 1-based line of the opening fence within the scanned text. */
  startLine: number
}

/** Opens a mermaid fence. Capture 1 is the backtick run, whose length the closer must match. */
export const MERMAID_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*mermaid[ \t]*$/i

/** Closes a 3-backtick fence. Longer openers need {@link closingFenceRegex}. */
export const MERMAID_FENCE_END_REGEX = /^[ \t]*`{3,}[ \t]*$/

/**
 * Closes a fence opened with `fenceLength` backticks. A shorter run is body
 * content: a 4-backtick fence is exactly how a diagram containing a
 * 3-backtick block is written.
 */
export function closingFenceRegex(fenceLength: number): RegExp {
  return new RegExp(`^[ \\t]*\`{${String(fenceLength)},}[ \\t]*$`)
}

export interface FenceBody {
  source: string
  /** Index of the closing fence line, or of the last body line when unterminated. */
  lastLineIndex: number
}

/** Collect the body between `startLineIndex`'s opener and its matching closer. */
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
