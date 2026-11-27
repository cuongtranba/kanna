import { Client, InMemoryTransport } from "@modelcontextprotocol/client"
import { SkillsClient, type Skill } from "@modelcontextprotocol/client/ext/skills"
import { McpServer } from "@modelcontextprotocol/server"
import { SkillsExtension, skillEntry } from "@modelcontextprotocol/server/ext/skills"
import type { McpServerConfig } from "../../../shared/mcp-types"
import type { McpSkillClock } from "../mcp-skill-host"
import type { McpSkillPort } from "../mcp-skill-port"

export type SkillFilesByPath = Record<string, Record<string, string>>

export interface SkillServerSpec {
  skills: SkillFilesByPath
  tampered?: Record<string, string>
  ttlMs?: number
  hangs?: boolean
  dynamic?: boolean
}

export const REFUNDS_SKILL_MD = "---\nname: refunds\ndescription: Issue a refund.\n---\n# Refunds\nRead references/policy.md first."
export const REFUNDS_POLICY = "Refunds over 100 need approval."

export const ACME_REFUNDS: SkillServerSpec = {
  skills: { "acme/refunds": { "SKILL.md": REFUNDS_SKILL_MD, "references/policy.md": REFUNDS_POLICY } },
}

export function stdioServer(name: string, overrides: Partial<Pick<McpServerConfig, "skills" | "enabled">> = {}): McpServerConfig {
  return {
    id: `id-${name}`,
    name,
    enabled: true,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    lastTest: { status: "untested" },
    transport: "stdio",
    command: "unused",
    args: [],
    env: {},
    ...overrides,
  }
}

async function connectSkillsClient(spec: SkillServerSpec): Promise<SkillsClient> {
  const entries: Skill[] = []
  const served = new Map<string, string>()
  for (const [path, files] of Object.entries(spec.skills)) {
    const entry = await skillEntry(path, files)
    entries.push(spec.dynamic ? { ...entry, resources: "dynamic" } : entry)
    for (const [relative, text] of Object.entries(files)) served.set(`skill://${path}/${relative}`, text)
  }
  for (const [uri, text] of Object.entries(spec.tampered ?? {})) served.set(uri, text)
  const extension = new SkillsExtension({
    source: {
      list: async () => ({ skills: entries }),
      get: async (uri) => entries.find((entry) => entry.uri === uri),
      read: async (uri) => {
        const text = served.get(uri)
        return text === undefined ? undefined : { text }
      },
    },
  })
  const server = new McpServer({ name: "skill-server", version: "1.0.0" })
  extension.attach(server)
  const [clientSide, serverSide] = InMemoryTransport.createLinkedPair()
  await server.connect(serverSide)
  const client = new Client({ name: "kanna-test", version: "1.0.0" })
  await client.connect(clientSide)
  return new SkillsClient(client)
}

export async function createInProcessSkillPort(specs: Record<string, SkillServerSpec>): Promise<McpSkillPort & { discoverCalls: string[] }> {
  const clients = new Map<string, SkillsClient>()
  for (const [name, spec] of Object.entries(specs)) clients.set(name, await connectSkillsClient(spec))
  const discoverCalls: string[] = []
  const clientOf = (server: McpServerConfig): SkillsClient => {
    const found = clients.get(server.name)
    if (!found) throw new Error(`no skill server named ${server.name}`)
    return found
  }
  return {
    discoverCalls,
    discover: async (server) => {
      discoverCalls.push(server.name)
      const spec = specs[server.name]
      if (spec?.hangs) return await new Promise<never>(() => {})
      const skills = clientOf(server)
      const listing = await skills.list()
      return { supported: skills.supported, directoryRead: skills.directoryRead, skills: listing.skills, ttlMs: spec?.ttlMs }
    },
    get: async (server, uri) => (await clientOf(server).get(uri)).skill,
    read: (server, skill, ref) => clientOf(server).read(skill, ref),
    readDirectory: async (server, uri) => (await clientOf(server).readDirectory(uri)).resources,
    close: async () => {},
  }
}

export function manualClock(start = 0): McpSkillClock & { advance(ms: number): void; fireTimers(): void } {
  let now = start
  const timers = new Set<() => void>()
  return {
    now: () => now,
    after: (_delayMs, run) => {
      timers.add(run)
      return () => { timers.delete(run) }
    },
    advance: (ms) => { now += ms },
    fireTimers: () => {
      for (const run of [...timers]) run()
    },
  }
}
