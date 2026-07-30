import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { ParsedClaudeSession } from "./claude-session-types"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"

export function scanClaudeSessions(homeDir: string = homedir()): ParsedClaudeSession[] {
  const projectsDir = path.join(homeDir, ".claude", "projects")
  if (!existsSync(projectsDir)) return []

  const sessions: ParsedClaudeSession[] = []
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const projDir = path.join(projectsDir, entry.name)

    for (const file of readdirSync(projDir, { withFileTypes: true })) {
      if (!file.isFile() || !file.name.endsWith(".jsonl")) continue
      const parsed = parseClaudeSessionFile(path.join(projDir, file.name))
      if (parsed) sessions.push(parsed)
    }
  }

  return sessions
}

/**
 * Locate one session's transcript by uuid: O(#project-dirs) existence checks,
 * never reads or hashes unrelated sessions (unlike scanClaudeSessions).
 */
export function locateClaudeSessionFile(homeDir: string, sessionId: string): string | null {
  const projectsDir = path.join(homeDir, ".claude", "projects")
  if (!existsSync(projectsDir)) return null
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}
