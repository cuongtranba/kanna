/**
 * Turning a typed `/name args` line into the prompt a provider actually runs.
 *
 * The claude CLI expands a slash command itself: it finds the `SKILL.md` or
 * `commands/*.md` on disk, substitutes the arguments, and feeds the result to
 * the model. A provider that does not run that CLI — Codex today, anything
 * added later — receives the literal string `/name args` and answers it as
 * prose, so the whole local skill catalog is dead weight there.
 *
 * This module is that expansion, minus the CLI. It is PURE: the caller reads
 * the file and resolves the catalog entry (`src/server/skill-invocation.ts`),
 * and everything here is text in, text out.
 *
 * Deliberately NOT reimplemented: `` !`cmd` `` (run a shell command, inline its
 * output) and `@path` (inline a file). Executing a shell command on the send
 * path would put arbitrary execution ahead of the turn that is meant to be
 * approving it. Both markers survive verbatim and the expansion tells the model
 * to resolve them with its own tools — which it has.
 */

import type { SlashCommandKind } from "./types"

export interface SlashInvocation {
  /** Command name with the leading slash removed — the catalog's own spelling. */
  name: string
  /** Everything after the name on the first line, trimmed at the edges. */
  args: string
  /**
   * Lines the user typed BELOW the command. A slash command is the first line,
   * not the whole message: refusing a multi-line send would throw away context
   * the user deliberately attached to the invocation.
   */
  trailing: string
}

/**
 * `:` covers plugin namespacing (`my-plugin:review`) and `/` covers a nested
 * project command (`ci/deploy`), both of which `scanLocalCatalog` really emits.
 * The first character must be alphanumeric so `//x` and `/ x` do not match.
 */
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

/**
 * Drop a leading `---` … `---` YAML block.
 *
 * Deliberately the same shape `parseFrontmatter` (`local-catalog-io.adapter.ts`)
 * assumes when it reads the metadata, so the half this returns and the half the
 * catalog read can never disagree about where the body starts. An unterminated
 * block is returned untouched rather than swallowing the file.
 */
export function stripFrontmatter(text: string): string {
  if (!text.startsWith("---")) return text
  const close = text.indexOf("\n---", 3)
  if (close < 0) return text
  const eol = text.indexOf("\n", close + 4)
  return eol < 0 ? "" : text.slice(eol + 1)
}

/** Whitespace split that keeps a quoted run together, as the CLI's `$1..$9` do. */
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

/**
 * Substitute `$ARGUMENTS` and `$1`..`$9`, in ONE pass.
 *
 * One pass is what stops a marker that arrived INSIDE the arguments from being
 * substituted again — `/foo $1` must send the literal `$1`, not whatever the
 * body's first positional happens to be.
 */
export function substituteArguments(body: string, args: string): string {
  const positional = splitArguments(args)
  return body.replace(/\$(ARGUMENTS|[1-9])/g, (_match, token: string) =>
    token === "ARGUMENTS" ? args : positional[Number(token) - 1] ?? "",
  )
}

export interface SlashExpansionSource {
  /** Canonical catalog name, without the leading slash. */
  name: string
  kind: SlashCommandKind
  /** Absolute path of the `SKILL.md` / command `.md` the body was read from. */
  filePath: string
}

/** What a resolved `/name` sends, and what the transcript records about it. */
export interface SlashCommandExpansion {
  /** Text the provider receives in place of the line the user typed. */
  prompt: string
  name: string
  kind: SlashCommandKind
}

const SHORTHAND_NOTE =
  "This file uses Claude Code shorthand: !`cmd` means run that shell command and use its output, and @path names a file — read it yourself with your own tools."

/** `!` + backtick is unambiguous; a bare `@word` is not (`a@b.com`, `@mention`). */
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

/**
 * The prompt a resolved `/name args` sends.
 *
 * A COMMAND expands to its substituted body and nothing else — a command file
 * *is* a prompt, and wrapping it would change what its author wrote. A SKILL
 * gets a header instead, because `SKILL.md` is a document about how to do
 * something rather than a request, and the model needs to be told it was asked
 * to act on it and where its companion files live.
 */
export function buildSlashExpansion(args: {
  source: SlashExpansionSource
  /** Raw file text, frontmatter still attached. */
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
