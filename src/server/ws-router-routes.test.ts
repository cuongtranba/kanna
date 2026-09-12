import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  COMMAND_TYPES_BY_GROUP,
  routeGroupOf,
  unhandledRoutedCommandMessage,
} from "./ws-router-routes"

const ROUTES_SOURCE = readFileSync(join(import.meta.dir, "ws-router-routes.ts"), "utf8")

describe("ws-router routes", () => {
  test("no command type is claimed by two groups", () => {
    const ownerByType = new Map<string, string>()
    const conflicts: string[] = []
    for (const [group, types] of Object.entries(COMMAND_TYPES_BY_GROUP)) {
      for (const type of types) {
        const existing = ownerByType.get(type)
        if (existing) conflicts.push(`${type}: ${existing} and ${group}`)
        else ownerByType.set(type, group)
      }
    }
    expect(conflicts).toEqual([])
  })

  test("commands that previously fell through to broadcastSnapshots now route", () => {
    expect(routeGroupOf("stack.setInstructions")).toBe("misc")
    expect(routeGroupOf("cron.update")).toBe("agentCtrl")
    expect(routeGroupOf("project.setInstructions")).toBe("project")
    expect(routeGroupOf("board.card.block")).toBe("board")
    expect(routeGroupOf("board.card.unblock")).toBe("board")
    expect(routeGroupOf("board.sync.unbind")).toBe("board")
  })

  test("the compile-time exhaustiveness assertion is still present", () => {
    expect(ROUTES_SOURCE).toContain("type RequireNever<T extends never> = T")
    expect(ROUTES_SOURCE).toContain("Exclude<ClientCommand[\"type\"], RoutedCommandType>")
    expect(ROUTES_SOURCE).toContain("RequireNever<UnroutedCommandType>")
  })

  test("every group owns at least one command and is compile-checked", () => {
    const checkedLists = ROUTES_SOURCE.match(/satisfies readonly ClientCommand\["type"\]\[\]/g) ?? []
    expect(checkedLists.length).toBeGreaterThanOrEqual(1)
    for (const types of Object.values(COMMAND_TYPES_BY_GROUP)) {
      expect(types.length).toBeGreaterThan(0)
    }
  })

  test("an unhandled routed command names the module that must change", () => {
    expect(unhandledRoutedCommandMessage("cron.update", "agentCtrl")).toContain("ws-router-agent-ctrl.ts")
    expect(unhandledRoutedCommandMessage("board.card.block", "board")).toContain("ws-router-boards.ts")
    expect(unhandledRoutedCommandMessage("chat.send", "chat")).toContain("ws-router-chat.ts")
  })
})
