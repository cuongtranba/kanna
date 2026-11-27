import type { DirectoryResource, Skill, SkillFile } from "@modelcontextprotocol/client/ext/skills"
import type { McpServerConfig } from "../../shared/mcp-types"

export interface McpSkillDiscovery {
  supported: boolean
  directoryRead: boolean
  skills: readonly Skill[]
  ttlMs?: number
}

export interface McpSkillPort {
  discover(server: McpServerConfig): Promise<McpSkillDiscovery>
  get(server: McpServerConfig, uri: string): Promise<Skill>
  read(server: McpServerConfig, skill: Skill, ref?: string): Promise<SkillFile>
  readDirectory(server: McpServerConfig, uri: string): Promise<readonly DirectoryResource[]>
  close(): Promise<void>
}
