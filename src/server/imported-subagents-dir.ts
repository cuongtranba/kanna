import { homedir } from "node:os"
import path from "node:path"
import { computeProjectDir } from "./claude-pty/jsonl-path.adapter"

/**
 * Derives the on-disk `subagents/` sidecar dir for an imported chat's
 * Claude session — `<computeProjectDir(cwd)>/<claudeSessionToken>/subagents`,
 * the same layout the live PTY driver registers against.
 */
export function deriveImportedSubagentsDir(args: {
  cwd: string
  claudeSessionToken: string
  homeDir?: string
}): string {
  const home = args.homeDir ?? homedir()
  return path.join(
    computeProjectDir({ homeDir: home, cwd: args.cwd }),
    args.claudeSessionToken,
    "subagents",
  )
}
