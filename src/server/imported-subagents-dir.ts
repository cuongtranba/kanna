import { homedir } from "node:os"
import path from "node:path"
import { computeProjectDir } from "./claude-pty/jsonl-path.adapter"

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
