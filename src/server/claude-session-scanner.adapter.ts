import { existsSync, readdirSync } from "node:fs"
import { homedir } from "node:os"
import path from "node:path"
import type { ParsedClaudeSession } from "./claude-session-types"
import { claudeProjectsRoot } from "./claude-projects-path.adapter"
import { parseClaudeSessionFile } from "./claude-session-parser.adapter"

export function scanClaudeSessions(homeDir: string = homedir()): ParsedClaudeSession[] {
  const projectsDir = claudeProjectsRoot(homeDir)
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

export function locateClaudeSessionFile(homeDir: string, sessionId: string): string | null {
  const projectsDir = claudeProjectsRoot(homeDir)
  if (!existsSync(projectsDir)) return null
  for (const entry of readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`)
    if (existsSync(candidate)) return candidate
  }
  return null
}
