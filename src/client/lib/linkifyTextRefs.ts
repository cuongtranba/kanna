/**
 * Pre-process markdown text to make common "reference + URL" patterns linkable.
 *
 * Converts natural-language constructs like:
 *   "PR #333 is open at https://github.com/repo/pull/333"
 * into Markdown links that Lexical can render:
 *   "[PR #333](https://github.com/repo/pull/333) is open at https://..."
 *
 * Patterns handled:
 *  - "PR #NNN" / "issue #NNN" / "fix #NNN" / "#NNN" near or before a URL
 *  - "#NNN" where NNN is a segment in a nearby URL's path
 *
 * Skips: content inside fenced code blocks, refs already wrapped in [...](...).
 *
 * Returns the original text unchanged when no transformations apply.
 */

const CODE_FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

const URL_RE = /https?:\/\/[^\s<>)\]'"]+/g

// Optional keyword prefix (group 1), then #NUMBER (group 2).
// Negative lookbehind instead of \b because # is not a word char —
// \b before # only fires when the previous char is a word char (rare),
// so bare "#NNN" after a space would never match with \b.
const REF_RE =
  /(?<![a-zA-Z0-9_])((?:PR|pull\s+request|merge\s+request|MR|issue|fix(?:es|ed)?|close[sd]?|resolve[sd]?|bug|task|ticket|story)\s+)?#(\d+)/gi

// Trailing punctuation chars that shouldn't be part of the URL
const TRAILING_PUNCT = /[.,;:!?)\]]+$/

export function linkifyTextRefs(text: string): string {
  if (!text.includes("#")) return text
  if (!text.includes("http")) return text

  const lines = text.split("\n")
  let inFence = false
  let changed = false
  const out: string[] = []

  for (const line of lines) {
    if (CODE_FENCE_RE.test(line)) {
      inFence = !inFence
      out.push(line)
      continue
    }
    if (inFence) {
      out.push(line)
      continue
    }
    const processed = processLine(line)
    if (processed !== line) changed = true
    out.push(processed)
  }

  return changed ? out.join("\n") : text
}

type UrlSpan = { start: number; end: number; url: string }
type RefSpan = { start: number; end: number; full: string; num: string }

function processLine(line: string): string {
  if (!line.includes("#")) return line
  if (!line.includes("http")) return line

  // ── 1. Collect URLs (strip trailing punctuation) ──────────────────────────
  const urls: UrlSpan[] = []
  const urlRe = new RegExp(URL_RE.source, "g")
  let m: RegExpExecArray | null
  while ((m = urlRe.exec(line)) !== null) {
    let url = m[0]
    const trail = url.match(TRAILING_PUNCT)
    if (trail) url = url.slice(0, -trail[0].length)
    urls.push({ start: m.index, end: m.index + url.length, url })
  }
  if (urls.length === 0) return line

  // ── 2. Collect refs not already inside markdown links ─────────────────────
  const refs: RefSpan[] = []
  const refRe = new RegExp(REF_RE.source, "gi")
  while ((m = refRe.exec(line)) !== null) {
    const before = line.slice(0, m.index)
    // Skip if inside an existing [...] link label
    if (before.lastIndexOf("[") > before.lastIndexOf("]")) continue
    refs.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      num: m[2] ?? "",
    })
  }
  if (refs.length === 0) return line

  // ── 3. Associate each ref with the best URL ───────────────────────────────
  const assoc = new Map<number, string>()

  for (const ref of refs) {
    // Priority A: any URL that contains the number as a path/query segment
    const byPath = urls.find((u) => {
      try {
        const { pathname, search } = new URL(u.url)
        const haystack = pathname + search
        return new RegExp(`(?:/|\\.|-|=)${ref.num}(?:[/?&#]|$)`).test(haystack)
      } catch {
        return false
      }
    })
    if (byPath) {
      assoc.set(ref.start, byPath.url)
      continue
    }

    // Priority B: nearest URL to the right without a sentence boundary in between
    const rightUrl = urls.find((u) => u.start > ref.end)
    if (rightUrl) {
      const between = line.slice(ref.end, rightUrl.start)
      // Allow up to 200 chars between ref and URL, no sentence-ending punctuation
      if (!/[.!?]\s/.test(between) && between.length < 200) {
        assoc.set(ref.start, rightUrl.url)
      }
    }
  }

  if (assoc.size === 0) return line

  // ── 4. Apply replacements right-to-left (preserve string indices) ─────────
  const toReplace = refs
    .filter((r) => assoc.has(r.start))
    .sort((a, b) => b.start - a.start)

  let result = line
  for (const ref of toReplace) {
    const url = assoc.get(ref.start)!
    result =
      result.slice(0, ref.start) +
      `[${ref.full}](${url})` +
      result.slice(ref.end)
  }
  return result
}
