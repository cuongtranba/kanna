
import type { MermaidErrorDetail } from "./mermaidError"

const TOKEN_CHARACTERS: Readonly<Record<string, string>> = {
  PS: "(",
  PE: ")",
  STR: '"',
  PIPE: "|",
  SQS: "[",
  SQE: "]",
  DIAMOND_START: "{",
  DIAMOND_STOP: "}",
}

const QUOTE_ADVICE =
  "Wrap the whole label in double quotes — a quoted label may contain anything. Write a literal `\"` as `#quot;`."

function opensUnclosedShape(line: string): boolean {
  return /\[[/\\]/.test(line) && !/[/\\]\]/.test(line)
}

function labelBody(line: string): string | null {
  const match = /\[([/\\][^\]]*)\]/.exec(line)
  return match?.[1] ?? null
}

function unclosedShapeHint(line: string): string | null {
  const body = labelBody(line)
  if (body === null) return null
  const node = /(\w+)\[/.exec(line)?.[1] ?? "A"
  return (
    "mermaid reads `[/` as the opener of a parallelogram, which must close `/]` or `\\]` — a bare `]` " +
    `ends the diagram there. That label looks like a path, so quote it: \`${node}["${body}"]\`.`
  )
}

function forbiddenCharacterHint(raw: string): string | null {
  const token = /got '([A-Z_]+)'/.exec(raw)?.[1]
  const character = token === undefined ? undefined : TOKEN_CHARACTERS[token]
  if (character === undefined) return null
  return `mermaid's label grammar has no rule for \`${character}\` in an unquoted label. ${QUOTE_ADVICE}`
}

export function hintForMermaidError(source: string, detail: MermaidErrorDetail): string | null {
  const raw = `${detail.summary} ${detail.excerpt ?? ""}`

  if (raw.includes("No diagram type detected")) {
    return "The first line must name a diagram type — `flowchart TD`, `sequenceDiagram`, `erDiagram`, and so on."
  }

  const forbidden = forbiddenCharacterHint(raw)
  if (forbidden !== null) return forbidden

  if (detail.line === null) return null
  const line = source.split("\n")[detail.line - 1]
  if (line === undefined) return null

  if (raw.includes("Unrecognized text") && opensUnclosedShape(line)) {
    return unclosedShapeHint(line)
  }

  return null
}
