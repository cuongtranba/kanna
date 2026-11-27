import { expect, test } from "vite-plus/test"
import { createMcpSkillAccess } from "./mcp-skill-access"
import { McpSkillHost } from "./mcp-skill-host"
import { ACME_REFUNDS, createInProcessSkillPort, manualClock, stdioServer } from "./test-helpers/in-process-skill-port"

async function accessFor() {
  const port = await createInProcessSkillPort({ acme: ACME_REFUNDS })
  const host = new McpSkillHost({ port, servers: async () => [stdioServer("acme")], clock: manualClock() })
  await host.refresh()
  return createMcpSkillAccess(host, () => new Set())
}

test("typing /server:name with arguments yields a prompt that loads that skill by server and uri", async () => {
  const access = await accessFor()

  const expansion = access.expandSlashCommand("chat-1", "/acme:refunds order 12")

  expect(expansion).toMatchObject({ name: "acme:refunds", kind: "skill" })
  expect(expansion?.prompt).toContain('server "acme"')
  expect(expansion?.prompt).toContain('uri "skill://acme/refunds/SKILL.md"')
  expect(expansion?.prompt).toContain("Arguments: order 12")
})

test("a slash command that no MCP server serves is left for the local catalog", async () => {
  const access = await accessFor()

  expect(access.expandSlashCommand("chat-1", "/review")).toBeNull()
})
