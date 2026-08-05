/**
 * Structure a raw mermaid render error so the UI can present it.
 *
 * mermaid surfaces jison parser failures as a multi-line string whose middle
 * two lines are an aligned excerpt:
 *
 *     Parse error on line 35:
 *     ...jsonb quotas  }  TENANT_SECRETS {
 *     --------------------^
 *     Expecting 'ATTRIBUTE_WORD', got 'BLOCK_STOP'
 *
 * Rendered as prose in a proportional font those newlines collapse and the
 * caret ruler points at nothing, which is how a diagnosable error became an
 * undiagnosable one. Splitting the message into {line, summary, excerpt} lets
 * the caller put the excerpt in a monospace block (alignment preserved) and
 * highlight the reported line in the source fallback.
 *
 * Pure — no DOM, no mermaid import.
 */

export interface MermaidErrorDetail {
  /** 1-based line in the diagram source, when the message reports one. */
  line: number | null
  /** Human-readable cause, newlines collapsed — safe for a prose element. */
  summary: string
  /** Caret-aligned excerpt (context + ruler). Monospace, `white-space: pre`. */
  excerpt: string | null
}

/** `Parse error on line 35:` / `Lexical error on line 3. Unrecognized text.` */
const HEADER_RE = /error on line (\d+)\s*[.:]?\s*(.*)$/i

/** The ruler line jison prints under the offending token: `-------^`. */
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
