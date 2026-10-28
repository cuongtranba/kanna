export interface SourceText {
  readonly path: string
  readonly text: string
}

export interface DuplicationMeasurement {
  readonly count: number
  readonly sites: readonly string[]
}

export const CLONE_WINDOW_LINES = 8

const STRUCTURAL_LINE = /^[{}()[\];,]*$|^(import|export \{|export \*|\} from)\b/

interface Window {
  readonly path: string
  readonly line: number
  readonly key: string
}

function windowsOf({ path, text }: SourceText): Window[] {
  const significant = text
    .split("\n")
    .map((raw, index) => ({ line: index + 1, text: raw.trim().replace(/\s+/g, " ") }))
    .filter((entry) => !STRUCTURAL_LINE.test(entry.text))
  const windows: Window[] = []
  for (let start = 0; start + CLONE_WINDOW_LINES <= significant.length; start += 1) {
    const slice = significant.slice(start, start + CLONE_WINDOW_LINES)
    windows.push({ path, line: slice[0]?.line ?? 0, key: slice.map((entry) => entry.text).join("\n") })
  }
  return windows
}

export function countCloneBlocks(sources: readonly SourceText[]): DuplicationMeasurement {
  const perFile = sources.map(windowsOf)
  const occurrences = new Map<string, number>()
  for (const windows of perFile) for (const { key } of windows) occurrences.set(key, (occurrences.get(key) ?? 0) + 1)

  const sites: string[] = []
  let count = 0
  for (const windows of perFile) {
    let inBlock = false
    for (const window of windows) {
      const duplicated = (occurrences.get(window.key) ?? 0) > 1
      if (duplicated && !inBlock) {
        count += 1
        if (sites.length < 5) sites.push(`${window.path}:${window.line}`)
      }
      inBlock = duplicated
    }
  }
  return { count, sites }
}

export interface LiteralFamily {
  readonly id: string
  readonly pattern: string
}

export const PROTOCOL_LITERAL_FAMILIES: readonly LiteralFamily[] = [
  { id: "env-var", pattern: "[\"'`]((?:KANNA|CLAUDE|ANTHROPIC)_[A-Z0-9_]+)[\"'`]" },
  { id: "route", pattern: "[\"'`](/(?:api|hooks|mcp|auth|share|beacon|oauth)(?:/[\\w\\-.:]*)*)[\"'`]" },
  { id: "bus-subject", pattern: "[\"'`](kanna\\.[a-z][\\w.\\-]*)[\"'`]" },
  { id: "storage-key", pattern: "[\"'`](kanna[:\\-][a-z][\\w:\\-.]*)[\"'`]" },
]

export function findLeakedLiterals(
  sources: readonly SourceText[],
  families: readonly LiteralFamily[] = PROTOCOL_LITERAL_FAMILIES,
): DuplicationMeasurement {
  const filesByLiteral = new Map<string, Set<string>>()
  for (const { path, text } of sources) {
    for (const family of families) {
      for (const match of text.matchAll(new RegExp(family.pattern, "g"))) {
        const literal = match[1]
        if (literal === undefined) continue
        const files = filesByLiteral.get(literal) ?? new Set<string>()
        files.add(path)
        filesByLiteral.set(literal, files)
      }
    }
  }
  const leaked = [...filesByLiteral.entries()]
    .filter(([, files]) => files.size > 1)
    .sort((a, b) => b[1].size - a[1].size || a[0].localeCompare(b[0]))
  return {
    count: leaked.length,
    sites: leaked.slice(0, 5).map(([literal, files]) => `${literal} in ${[...files].sort().join(", ")}`),
  }
}
