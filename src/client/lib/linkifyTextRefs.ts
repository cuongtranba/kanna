
const CODE_FENCE_RE = /^[ \t]*(`{3,}|~{3,})/

const URL_RE = /https?:\/\/[^\s<>)\]'"]+/g

const REF_RE =
  /(?<![a-zA-Z0-9_])((?:PR|pull\s+request|merge\s+request|MR|issue|fix(?:es|ed)?|close[sd]?|resolve[sd]?|bug|task|ticket|story)\s+)?#(\d+)/gi

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

  const refs: RefSpan[] = []
  const refRe = new RegExp(REF_RE.source, "gi")
  while ((m = refRe.exec(line)) !== null) {
    const before = line.slice(0, m.index)
    if (before.lastIndexOf("[") > before.lastIndexOf("]")) continue
    refs.push({
      start: m.index,
      end: m.index + m[0].length,
      full: m[0],
      num: m[2] ?? "",
    })
  }
  if (refs.length === 0) return line

  const assoc = new Map<number, string>()

  for (const ref of refs) {
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

    const rightUrl = urls.find((u) => u.start > ref.end)
    if (rightUrl) {
      const between = line.slice(ref.end, rightUrl.start)
      if (!/[.!?]\s/.test(between) && between.length < 200) {
        assoc.set(ref.start, rightUrl.url)
      }
    }
  }

  if (assoc.size === 0) return line

  const toReplace = refs
    .filter((r) => assoc.has(r.start))
    .sort((a, b) => b.start - a.start)

  let result = line
  for (const ref of toReplace) {
    const url = assoc.get(ref.start)!
    result =
      `${result.slice(0, ref.start) 
      }[${ref.full}](${url})${ 
      result.slice(ref.end)}`
  }
  return result
}
