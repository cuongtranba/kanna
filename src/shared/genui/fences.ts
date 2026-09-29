import { scanFenceBody } from "../mermaid-fences"

export const KANNA_UI_FENCE_LANGUAGE = "kanna-ui"
export const KANNA_UI_INTENT_FENCE_LANGUAGE = "kanna-ui-intent"

export const KANNA_UI_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*kanna-ui[ \t]*$/i
export const KANNA_UI_INTENT_FENCE_START_REGEX = /^[ \t]*(`{3,})[ \t]*kanna-ui-intent[ \t]*$/i

export interface KannaUiFence {
  source: string
  startLine: number
  closed: boolean
}

function extractFences(markdown: string, startRegex: RegExp): KannaUiFence[] {
  const lines = markdown.split("\n")
  const fences: KannaUiFence[] = []
  let index = 0
  while (index < lines.length) {
    const start = startRegex.exec(lines[index] ?? "")
    if (!start) {
      index += 1
      continue
    }
    const body = scanFenceBody(lines, index, start[1] ?? "```")
    fences.push({ source: body.source, startLine: index + 1, closed: body.closed })
    index = body.lastLineIndex + 1
  }
  return fences
}

export function extractKannaUiFences(markdown: string): KannaUiFence[] {
  return extractFences(markdown, KANNA_UI_FENCE_START_REGEX)
}

export function extractKannaUiIntentFences(markdown: string): KannaUiFence[] {
  return extractFences(markdown, KANNA_UI_INTENT_FENCE_START_REGEX)
}

export function fenceBlock(language: string, source: string): string {
  const longestRun = Math.max(2, ...[...source.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = "`".repeat(longestRun + 1)
  return `${fence}${language}\n${source}\n${fence}`
}
