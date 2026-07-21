/**
 * Markdown adapter for the structured-document engine (pure).
 *
 * mdast is used purely as a PARSER to locate section + list-item boundaries
 * via source `position` offsets; every slice is taken from the ORIGINAL
 * string, so queries and appends are byte-faithful (no reserialization of
 * untouched content). Only the inserted line changes on append. GFM parsing
 * is enabled so tables / task-lists tokenize correctly.
 */

import type { List, Root } from "mdast"
import { fromMarkdown } from "mdast-util-from-markdown"
import { gfmFromMarkdown } from "mdast-util-gfm"
import { gfm } from "micromark-extension-gfm"

import type {
  AppendRequest,
  SectionInfo,
  SectionQuery,
  StructuredDoc,
  StructuredDocAppendResult,
  StructuredDocQueryResult,
} from "./types"

/** Level-2 section boundaries computed from source offsets. */
interface Section {
  headingRaw: string
  normalized: string
  depth: number
  /** Offset of the `##` marker. */
  startOffset: number
  /** Offset just past the heading text (before its newline). */
  bodyStart: number
  /** Offset where the section ends (next `depth<=2` heading, or EOF). */
  endOffset: number
}

function parse(content: string): Root {
  return fromMarkdown(content, {
    extensions: [gfm()],
    mdastExtensions: [gfmFromMarkdown()],
  })
}

/** Strip the leading `#` marker, trim, lowercase — the matching key. */
function normalizeHeading(raw: string): string {
  return raw.replace(/^#+\s*/, "").trim().toLowerCase()
}

function normalizeQuery(name: string): string {
  return name.replace(/^#+\s*/, "").trim().toLowerCase()
}

function offset(point: { offset?: number } | undefined, fallback: number): number {
  return point?.offset ?? fallback
}

/** All level-2 sections, in document order, with source-offset boundaries. */
function computeSections(content: string, root: Root): Section[] {
  const kids = root.children
  const out: Section[] = []
  for (let i = 0; i < kids.length; i++) {
    const node = kids[i]
    if (node.type !== "heading" || node.depth !== 2 || !node.position) continue
    const startOffset = offset(node.position.start, 0)
    const bodyStart = offset(node.position.end, startOffset)
    let endOffset = content.length
    for (let j = i + 1; j < kids.length; j++) {
      const next = kids[j]
      if (next.type === "heading" && next.depth <= 2 && next.position) {
        endOffset = offset(next.position.start, content.length)
        break
      }
    }
    const headingRaw = content.slice(startOffset, bodyStart)
    out.push({
      headingRaw,
      normalized: normalizeHeading(headingRaw),
      depth: 2,
      startOffset,
      bodyStart,
      endOffset,
    })
  }
  return out
}

function matchesAny(sec: Section, wanted: readonly string[]): boolean {
  return wanted.some((w) => sec.normalized.startsWith(normalizeQuery(w)))
}

/** First top-level list wholly contained in a section's body, else null. */
function firstListInSection(root: Root, sec: Section): List | null {
  for (const node of root.children) {
    if (node.type !== "list" || !node.position) continue
    const start = offset(node.position.start, -1)
    const end = offset(node.position.end, -1)
    if (start >= sec.bodyStart && end <= sec.endOffset) return node
  }
  return null
}

/** Section source text, with its first list trimmed to `limit` items. */
function sectionText(content: string, root: Root, sec: Section, limit?: number): string {
  const full = content.slice(sec.startOffset, sec.endOffset)
  if (limit == null || limit < 1) return full
  const list = firstListInSection(root, sec)
  if (!list || list.children.length <= limit) return full
  const keptItem = list.children[limit - 1]
  if (!keptItem.position) return full
  const keptEnd = offset(keptItem.position.end, sec.endOffset)
  const listEnd = offset(list.position?.end, sec.endOffset)
  const dropped = list.children.length - limit
  const head = content.slice(sec.startOffset, keptEnd)
  const tail = content.slice(listEnd, sec.endOffset)
  return `${head}\n_(+${dropped} older entries omitted; query without listLimit to see all)_${tail}`
}

function findSection(sections: readonly Section[], name: string): Section | undefined {
  const q = normalizeQuery(name)
  return sections.find((s) => s.normalized.startsWith(q))
}

export const markdownDoc: StructuredDoc = {
  format: "markdown",

  sections(content: string): readonly SectionInfo[] {
    const root = parse(content)
    return computeSections(content, root).map((s) => ({
      heading: s.headingRaw.replace(/^#+\s*/, "").trim(),
      normalized: s.normalized,
      depth: s.depth,
    }))
  },

  query(content: string, q: SectionQuery): StructuredDocQueryResult {
    const root = parse(content)
    const sections = computeSections(content, root)
    const wanted = q.sections && q.sections.length > 0 ? q.sections : null

    const matched: string[] = []
    const parts: string[] = []
    for (const sec of sections) {
      if (wanted && !matchesAny(sec, wanted)) continue
      matched.push(sec.normalized)
      parts.push(sectionText(content, root, sec, q.listLimit).replace(/\s+$/, ""))
    }

    const missing = wanted
      ? wanted
          .map(normalizeQuery)
          .filter((w) => !sections.some((s) => s.normalized.startsWith(w)))
      : []

    return {
      content: parts.length > 0 ? `${parts.join("\n\n")}\n` : "",
      matched,
      missing,
    }
  },

  append(content: string, req: AppendRequest): StructuredDocAppendResult {
    const root = parse(content)
    const sections = computeSections(content, root)
    const entry = req.entry.replace(/\n+$/, "")
    const target = findSection(sections, req.section)

    if (!target) {
      const heading = req.section.startsWith("#") ? req.section : `## ${req.section}`
      const sep = content.length === 0 || content.endsWith("\n") ? "" : "\n"
      return { content: `${content}${sep}\n${heading}\n\n${entry}\n`, created: true }
    }

    if ((req.position ?? "bottom") === "top") {
      const before = content.slice(0, target.bodyStart)
      const after = content.slice(target.bodyStart)
      const gap = after.startsWith("\n") ? "" : "\n"
      return { content: `${before}\n\n${entry}${gap}${after}`, created: false }
    }

    // bottom: append after the section body, trimming its trailing blanks.
    const body = content.slice(target.startOffset, target.endOffset).replace(/\s+$/, "")
    const rest = content.slice(target.endOffset).replace(/^\n+/, "")
    const tail = rest.length > 0 ? `\n\n${rest}` : "\n"
    return { content: `${content.slice(0, target.startOffset)}${body}\n${entry}${tail}`, created: false }
  },
}

/** Exported for direct unit testing; production consumers use the registry. */
export const __testing = { normalizeHeading }
