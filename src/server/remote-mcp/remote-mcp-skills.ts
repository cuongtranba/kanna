import { SkillsExtension, type SkillCatalog, type SkillFiles, type SkillWarning } from "@modelcontextprotocol/server/ext/skills"
import { toError } from "../../shared/errors"
import { log } from "../../shared/log"

export const REMOTE_MCP_SKILLS_RELOAD_MS = 30_000

export interface RemoteMcpSkillsOptions {
  files: SkillFiles
  now: () => number
  onListChanged: () => void
}

export interface RemoteMcpSkills {
  current(): Promise<SkillCatalog | null>
}

function logWarning(warning: SkillWarning): void {
  log.debug("[kanna/remote-mcp] skill skipped", { path: warning.path, message: warning.message })
}

export function createRemoteMcpSkills({ files, now, onListChanged }: RemoteMcpSkillsOptions): RemoteMcpSkills {
  let catalog: SkillCatalog | null = null
  let checkedAt: number | null = null
  let pending: Promise<SkillCatalog | null> | null = null

  async function refresh(): Promise<SkillCatalog | null> {
    checkedAt = now()
    try {
      if (catalog === null) {
        catalog = await SkillsExtension.load(files, { onWarning: logWarning })
      } else if ((await catalog.reload()).listChanged) {
        onListChanged()
      }
    } catch (error) {
      log.warn("[kanna/remote-mcp] loading local skills failed", { message: toError(error).message })
    }
    return catalog
  }

  return {
    current() {
      if (pending) return pending
      if (checkedAt !== null && now() - checkedAt < REMOTE_MCP_SKILLS_RELOAD_MS) return Promise.resolve(catalog)
      pending = refresh().finally(() => { pending = null })
      return pending
    },
  }
}
