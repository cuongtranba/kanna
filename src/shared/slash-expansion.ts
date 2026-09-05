
import type { SlashCommandKind } from "./types"

export interface SlashInvocation {
  name: string
  args: string
  trailing: string
}

const INVOCATION_PATTERN = /^\/([A-Za-z0-9_][A-Za-z0-9_.:/-]*)(?:[ \t]+(.*))?$/

export function parseSlashInvocation(content: string): SlashInvocation | null {
  const newline = content.indexOf("\n")
  const firstLine = (newline < 0 ? content : content.slice(0, newline)).trim()
  const match = INVOCATION_PATTERN.exec(firstLine)
  if (!match) return null
  return {
    name: match[1] ?? "",
    args: (match[2] ?? "").trim(),
    trailing: newline < 0 ? "" : content.slice(newline + 1).trim(),
  }
}

export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text
  const close = text.indexOf("\n---", 3)
  if (close < 0) return text
  const eol = text.indexOf("\n", close + 4)
  return eol < 0 ? "" : text.slice(eol + 1)
}

export function splitArguments(args: string): string[] {
  const out: string[] = []
  let current = ""
  let quote: '"' | "'" | null = null
  let started = false
  for (const char of args) {
    if (quote) {
      if (char === quote) quote = null
      else current += char
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (/\s/.test(char)) {
      if (started) out.push(current)
      current = ""
      started = false
      continue
    }
    current += char
    started = true
  }
  if (started) out.push(current)
  return out
}

export function substituteArguments(body: string, args: string): string {
  const positional = splitArguments(args)
  return body.replace(/\$(ARGUMENTS|[1-9])/g, (_match, token: string) =>
    token === "ARGUMENTS" ? args : positional[Number(token) - 1] ?? "",
  )
}

export interface SlashExpansionSource {
  name: string
  kind: SlashCommandKind
  filePath: string
}

export interface SlashCommandExpansion {
  prompt: string
  name: string
  kind: SlashCommandKind
}

const SHORTHAND_NOTE =
  "This file uses Claude Code shorthand: !`cmd` means run that shell command and use its output, and @path names a file — read it yourself with your own tools."

const BASH_MARKER = /!`[^`]+`/
const FILE_MARKER = /(?:^|\s)@[\w./-]+\//m

function directoryOf(filePath: string): string {
  const cut = filePath.lastIndexOf("/")
  return cut <= 0 ? filePath : filePath.slice(0, cut)
}

function skillHeader(source: SlashExpansionSource, args: string): string[] {
  const lines = [
    `The user invoked the \`${source.name}\` skill. Follow the instructions below for this request.`,
    "",
    `Skill directory: ${directoryOf(source.filePath)} — read any file the instructions reference from there.`,
  ]
  if (args) lines.push(`Arguments: ${args}`)
  return lines
}

export function buildSlashExpansion(args: {
  source: SlashExpansionSource
  body: string
  invocation: SlashInvocation
}): string {
  const body = substituteArguments(stripFrontmatter(args.body), args.invocation.args).trim()

  const sections: string[] = []
  if (args.source.kind === "skill") {
    sections.push(skillHeader(args.source, args.invocation.args).join("\n"))
  }
  sections.push(body)
  if (BASH_MARKER.test(body) || FILE_MARKER.test(body)) sections.push(SHORTHAND_NOTE)
  if (args.invocation.trailing) sections.push(args.invocation.trailing)

  return sections.filter((section) => section.length > 0).join("\n\n")
}
