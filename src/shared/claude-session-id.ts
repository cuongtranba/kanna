// src/shared/claude-session-id.ts
const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi

/** Extract a Claude session UUID from pasted text (bare id, filename, or path). */
export function extractSessionId(input: string): string | null {
  const matches = input.match(UUID_RE)
  if (!matches || matches.length === 0) return null
  // Last match wins: in a full path the session uuid is the basename.
  return matches[matches.length - 1].toLowerCase()
}

export function extractSessionIds(input: string): string[] {
  const out: string[] = []
  for (const token of input.split(/[\s,]+/)) {
    if (!token) continue
    const id = extractSessionId(token)
    if (id && !out.includes(id)) out.push(id)
  }
  return out
}
