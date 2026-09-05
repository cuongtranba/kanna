
export interface MermaidErrorDetail {
  line: number | null
  summary: string
  excerpt: string | null
}

const HEADER_RE = /error on line (\d+)\s*[.:]?\s*(.*)$/i

const CARET_RE = /^[\s-]*\^\s*$/

function collapse(lines: readonly string[]): string {
  return lines
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join(" ")
}

export function parseMermaidError(raw: string): MermaidErrorDetail {
  const text = raw.trim()
  if (text.length === 0) {
    return { line: null, summary: "Unknown error", excerpt: null }
  }

  const lines = text.split("\n")
  const headerIndex = lines.findIndex((line) => HEADER_RE.test(line))
  const header = headerIndex === -1 ? null : HEADER_RE.exec(lines[headerIndex] ?? "")
  if (header === null) {
    return { line: null, summary: collapse(lines), excerpt: null }
  }

  const reported = Number(header[1])
  const rest = lines.slice(headerIndex + 1)
  const caretIndex = rest.findIndex((line) => CARET_RE.test(line))
  const excerpt = caretIndex === -1 ? null : rest.slice(0, caretIndex + 1).join("\n")
  const tail = caretIndex === -1 ? rest : rest.slice(caretIndex + 1)

  const summary = collapse([header[2] ?? "", ...tail])

  return {
    line: Number.isInteger(reported) ? reported : null,
    summary: summary.length > 0 ? summary : `Parse error on line ${String(reported)}`,
    excerpt,
  }
}
