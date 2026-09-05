
import type { MermaidDefect } from "./mermaid-validation"

export interface MermaidFailure {
  startLine: number
  defect: MermaidDefect
}

export function formatMermaidDefect(defect: MermaidDefect): string {
  const where = defect.line === null ? "" : ` on line ${String(defect.line)}`
  const parts = [`Invalid mermaid${where}: ${defect.summary}`]
  if (defect.excerpt !== null) parts.push(defect.excerpt)
  if (defect.hint !== null) parts.push(defect.hint)
  return parts.join("\n")
}

export function formatMermaidCorrection(failures: readonly MermaidFailure[]): string {
  const count = failures.length
  const noun = count === 1 ? "diagram" : "diagrams"
  const blocks = failures.map((failure) => {
    const header = `The diagram whose fence opens on line ${String(failure.startLine)} of your message:`
    return `${header}\n${formatMermaidDefect(failure.defect)}`
  })

  return [
    `${String(count)} mermaid ${noun} you just wrote will not render.`,
    ...blocks,
    "Fix the source and post the corrected diagram. Validate it with `mcp__kanna__validate_mermaid` before you send it.",
  ].join("\n\n")
}
