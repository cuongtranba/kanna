import { describe, expect, test } from "vite-plus/test"
import { COMMAND_REGISTRY, remotePolicyOf, type CommandType } from "../../shared/commands"
import { subscriptionTopicSchema } from "../../shared/protocol.schema"
import { REMOTE_TOOLS } from "./remote-mcp-tool-table"
import type { RemoteTool } from "./remote-mcp-tool-spec"

function registryParams(command: string): string[] {
  return Object.keys(COMMAND_REGISTRY.find((definition) => definition.type === command)?.params.shape ?? {})
}

function backedCommands({ backing }: RemoteTool): readonly CommandType[] {
  if (backing.kind === "command") return [backing.command]
  return backing.kind === "topic" ? backing.commands : []
}

const TOPIC_TYPES: readonly string[] = subscriptionTopicSchema.options.map((option) => option.shape.type.value)

describe("remote MCP tool table", () => {
  test("every tool has its own name", () => {
    const names = REMOTE_TOOLS.map((tool) => tool.name)

    expect(new Set(names).size).toBe(names.length)
  })

  test("every command a tool is backed by is allowed to run remotely", () => {
    for (const tool of REMOTE_TOOLS) {
      for (const command of backedCommands(tool)) {
        expect({ tool: tool.name, command, remote: remotePolicyOf(command).kind }).toEqual({ tool: tool.name, command, remote: "allowed" })
      }
    }
  })

  test("a command-backed tool accepts every param of its command except those hidden with a reason", () => {
    for (const tool of REMOTE_TOOLS) {
      if (tool.backing.kind !== "command") continue
      const { command, hidden } = tool.backing
      const params = registryParams(command)
      const accepted = Object.keys(tool.input.shape)

      const missing = params.filter((param) => !(param in hidden) && !accepted.includes(param))
      const notParams = Object.keys(hidden).filter((field) => !params.includes(field))
      const stillAccepted = Object.keys(hidden).filter((field) => accepted.includes(field))
      const unexplained = Object.entries(hidden).filter(([, reason]) => reason.trim().length === 0).map(([field]) => field)

      expect({ tool: tool.name, missing, notParams, stillAccepted, unexplained }).toEqual({
        tool: tool.name,
        missing: [],
        notParams: [],
        stillAccepted: [],
        unexplained: [],
      })
    }
  })

  test("a topic-backed tool names a real subscription topic and an MCP-only tool says why no command or topic backs it", () => {
    for (const tool of REMOTE_TOOLS) {
      if (tool.backing.kind === "topic") expect({ tool: tool.name, known: TOPIC_TYPES.includes(tool.backing.topic) }).toEqual({ tool: tool.name, known: true })
      if (tool.backing.kind === "mcp-only") expect({ tool: tool.name, reason: tool.backing.reason.trim().length > 0 }).toEqual({ tool: tool.name, reason: true })
    }
  })
})
