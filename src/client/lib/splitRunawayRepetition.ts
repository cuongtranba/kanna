import { closingFenceRegex } from "../../shared/mermaid-fences"

export type RepetitionSegment =
  | { kind: "markdown"; text: string }
  | { kind: "repeated"; block: string; count: number }

export const RUNAWAY_REPEAT_MIN = 20

const FENCE_OPEN_REGEX = /^[ \t]*(`{3,})/

interface Block {
  text: string
  firstLine: number
  lastLine: number
}

function isBlank(line: string): boolean {
  return line.trim().length === 0
}

function pushMarkdown(segments: RepetitionSegment[], lines: readonly string[]): void {
  const text = lines.join("\n").replace(/^(?:[ \t]*\n)+/, "").replace(/(?:\n[ \t]*)+$/, "")
  if (text.trim().length > 0) segments.push({ kind: "markdown", text })
}

function fenceEnd(lines: readonly string[], openLine: number, fence: string): number {
  const closing = closingFenceRegex(fence.length)
  for (let i = openLine + 1; i < lines.length; i++) {
    if (closing.test(lines[i] ?? "")) return i
  }
  return lines.length - 1
}

function splitBlocks(lines: readonly string[]): Block[] {
  const blocks: Block[] = []
  let index = 0
  while (index < lines.length) {
    if (isBlank(lines[index] ?? "")) {
      index += 1
      continue
    }
    const firstLine = index
    while (index < lines.length && !isBlank(lines[index] ?? "")) {
      const fence = FENCE_OPEN_REGEX.exec(lines[index] ?? "")
      index = (fence ? fenceEnd(lines, index, fence[1] ?? "```") : index) + 1
    }
    const lastLine = index - 1
    blocks.push({
      text: lines.slice(firstLine, index).join("\n").trimEnd(),
      firstLine,
      lastLine,
    })
  }
  return blocks
}

export function splitRunawayRepetition(markdown: string): RepetitionSegment[] {
  const lines = markdown.split("\n")
  const blocks = splitBlocks(lines)
  const segments: RepetitionSegment[] = []
  let cursorLine = 0
  let runStart = 0

  for (let i = 1; i <= blocks.length; i++) {
    const first = blocks[runStart]
    if (!first) break
    if (blocks[i]?.text === first.text) continue
    const count = i - runStart
    const last = blocks[i - 1]
    if (count >= RUNAWAY_REPEAT_MIN && last) {
      pushMarkdown(segments, lines.slice(cursorLine, first.firstLine))
      segments.push({ kind: "repeated", block: first.text, count })
      cursorLine = last.lastLine + 1
    }
    runStart = i
  }

  if (segments.length === 0) return [{ kind: "markdown", text: markdown }]
  pushMarkdown(segments, lines.slice(cursorLine))
  return segments
}
