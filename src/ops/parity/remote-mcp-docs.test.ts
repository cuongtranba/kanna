import { describe, expect, test } from "vite-plus/test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { COMMAND_REGISTRY, commandDomain, type CommandType } from "../../shared/commands"
import { listHttpRoutes, type HttpRouteRemote } from "../../shared/http-routes"

const PAGE = readFileSync(join(import.meta.dirname, "..", "..", "..", "wiki", "src", "content", "docs", "guides", "user", "remote-mcp.md"), "utf8")

function targetOf(remote: HttpRouteRemote): string | null {
  if (remote.kind === "mcp-tool") return remote.tool
  if (remote.kind === "command") return remote.type
  return null
}

function namesCommand(definitionType: CommandType): boolean {
  const member = definitionType.slice(definitionType.indexOf(".") + 1)
  const groupedUnderDomain = PAGE.includes(`\`${member}\``) && PAGE.includes(`\`${commandDomain(definitionType)}.*\``)
  return PAGE.includes(`\`${definitionType}\``) || groupedUnderDomain
}

describe("the remote MCP page states what a remote client cannot do", () => {
  test("every command the registry excludes from remote use is named on the page", () => {
    const unnamed = COMMAND_REGISTRY.flatMap((definition) => {
      if (definition.remote.kind !== "excluded") return []
      return namesCommand(definition.type) ? [] : [definition.type]
    })
    expect(unnamed).toEqual([])
  })

  test("every HTTP route of the web client is answered on the page with its tool, its command or its exclusion", () => {
    const unanswered = listHttpRoutes().flatMap((route) => {
      const stem = route.path.split("*")[0]?.replace(/\/$/, "") ?? route.path
      const target = targetOf(route.remote)
      const answered = PAGE.includes(`\`${stem}`) && (target === null || PAGE.includes(`\`${target}\``))
      return answered ? [] : [route.path]
    })
    expect(unanswered).toEqual([])
  })
})
