import ts from "typescript"
import { Glob } from "bun"
import { join, relative } from "node:path"

export interface ScopeRoot {
  readonly dir: string
  readonly glob: string
}

export const SCOPE_ROOTS: readonly ScopeRoot[] = [
  { dir: "src", glob: "**/*.{ts,tsx}" },
  { dir: "scripts", glob: "**/*.{ts,tsx}" },
  { dir: "e2e", glob: "**/*.{ts,tsx}" },
]

const DIRECTIVE_MARKERS: readonly string[] = [
  "eslint-disable",
  "eslint-enable",
  "@ts-expect-error",
  "@ts-ignore",
  "@ts-nocheck",
  "@vite-ignore",
  "webpackChunkName",
  "webpackIgnore",
  "webpackPreload",
  "webpackPrefetch",
  "prettier-ignore",
  "biome-ignore",
  "ast-grep-ignore",
  "istanbul ignore",
  "c8 ignore",
  "v8 ignore",
  "@license",
  "@preserve",
  "SPDX-",
  "@jsxImportSource",
  "#__PURE__",
  "@__PURE__",
]

export function isDirectiveComment(raw: string): boolean {
  if (/^\/\/\/\s*<(?:reference|amd-)/.test(raw)) return true
  return DIRECTIVE_MARKERS.some((marker) => raw.includes(marker))
}

export interface CommentHit {
  readonly pos: number
  readonly end: number
  readonly line: number
  readonly raw: string
}

interface Removal {
  readonly pos: number
  readonly end: number
}

function scriptKind(fileName: string): ts.ScriptKind {
  if (fileName.endsWith(".tsx")) return ts.ScriptKind.TSX
  return ts.ScriptKind.TS
}

export function findComments(fileName: string, text: string): CommentHit[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const seen = new Set<string>()
  const hits: CommentHit[] = []

  const record = (range: ts.CommentRange): void => {
    const key = `${range.pos}:${range.end}`
    if (seen.has(key)) return
    seen.add(key)
    const raw = text.slice(range.pos, range.end)
    if (isDirectiveComment(raw)) return
    hits.push({
      pos: range.pos,
      end: range.end,
      line: source.getLineAndCharacterOfPosition(range.pos).line + 1,
      raw,
    })
  }

  const visit = (node: ts.Node): void => {
    for (const range of ts.getLeadingCommentRanges(text, node.getFullStart()) ?? []) {
      record(range)
    }
    for (const range of ts.getTrailingCommentRanges(text, node.getEnd()) ?? []) {
      record(range)
    }
    for (const child of node.getChildren(source)) visit(child)
  }
  visit(source)

  hits.sort((a, b) => a.pos - b.pos)
  return hits
}

function findEmptyJsxExpressions(fileName: string, text: string): Removal[] {
  const source = ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    scriptKind(fileName),
  )
  const found: Removal[] = []
  const visit = (node: ts.Node): void => {
    if (ts.isJsxExpression(node) && node.expression === undefined) {
      const pos = node.getStart(source)
      const end = node.getEnd()
      if (!isDirectiveComment(text.slice(pos, end))) found.push({ pos, end })
      return
    }
    node.forEachChild(visit)
  }
  visit(source)
  return found
}

function isBlank(slice: string): boolean {
  return /^[ \t]*$/.test(slice)
}

function expandToWholeLine(text: string, removal: Removal): Removal {
  let lineStart = removal.pos
  while (lineStart > 0 && text[lineStart - 1] !== "\n") lineStart -= 1

  let lineEnd = removal.end
  while (lineEnd < text.length && text[lineEnd] !== "\n") lineEnd += 1

  const before = text.slice(lineStart, removal.pos)
  const after = text.slice(removal.end, lineEnd)

  if (isBlank(before) && isBlank(after)) {
    return { pos: lineStart, end: lineEnd < text.length ? lineEnd + 1 : lineEnd }
  }
  if (isBlank(before)) return removal

  let trimmed = removal.pos
  while (trimmed > lineStart && (text[trimmed - 1] === " " || text[trimmed - 1] === "\t")) {
    trimmed -= 1
  }
  return { pos: trimmed, end: removal.end }
}

function mergeRemovals(removals: readonly Removal[]): Removal[] {
  const sorted = [...removals].sort((a, b) => a.pos - b.pos || a.end - b.end)
  const merged: Removal[] = []
  for (const next of sorted) {
    const last = merged[merged.length - 1]
    if (last !== undefined && next.pos <= last.end) {
      if (next.end > last.end) merged[merged.length - 1] = { pos: last.pos, end: next.end }
      continue
    }
    merged.push(next)
  }
  return merged
}

export function stripComments(fileName: string, text: string): string {
  const jsxHoles = findEmptyJsxExpressions(fileName, text)
  const removals: Removal[] = []

  for (const hole of jsxHoles) removals.push(expandToWholeLine(text, hole))

  const inJsxHole = (hit: CommentHit): boolean =>
    jsxHoles.some((hole) => hit.pos >= hole.pos && hit.end <= hole.end)

  for (const hit of findComments(fileName, text)) {
    if (inJsxHole(hit)) continue
    removals.push(expandToWholeLine(text, { pos: hit.pos, end: hit.end }))
  }

  if (removals.length === 0) return text

  let out = ""
  let cursor = 0
  for (const removal of mergeRemovals(removals)) {
    out += text.slice(cursor, removal.pos)
    cursor = removal.end
  }
  out += text.slice(cursor)
  return out
}

export async function listScopedFiles(repoRoot: string): Promise<string[]> {
  const files: string[] = []
  for (const root of SCOPE_ROOTS) {
    const base = join(repoRoot, root.dir)
    const glob = new Glob(root.glob)
    for await (const found of glob.scan({ cwd: base, absolute: true, onlyFiles: true })) {
      files.push(relative(repoRoot, found))
    }
  }
  return files.sort()
}
