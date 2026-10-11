import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { COMMAND_CATALOG, isCatalogedCommandType, listCommandCatalog } from "./command-catalog"

const SHARED_DIR = join(import.meta.dir, "..")
const VALID_RISKS = ["read", "write", "destructive", "local", "unavailable"]

function unionBody(source: string, unionName: string): string {
  const start = source.indexOf(`export type ${unionName} =`)
  if (start < 0) throw new Error(`union ${unionName} not found`)
  const rest = source.slice(start + `export type ${unionName} =`.length)
  const end = rest.search(/\nexport (?:type|interface|const|function) /)
  return end < 0 ? rest : rest.slice(0, end)
}

function declaredCommandTypes(): readonly string[] {
  const protocol = readFileSync(join(SHARED_DIR, "protocol.ts"), "utf8")
  const shareProtocol = readFileSync(join(SHARED_DIR, "session-share", "protocol.ts"), "utf8")
  const found = new Set<string>()
  const bodies = [
    unionBody(protocol, "ClientCommand"),
    unionBody(shareProtocol, "ShareClientCommand"),
  ]
  for (const body of bodies) {
    for (const match of body.matchAll(/\btype: "([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) {
      found.add(match[1]!)
    }
  }
  for (const match of shareProtocol.matchAll(/export const SHARE_CMD_[A-Z]+ = "([a-z.]+)"/g)) {
    found.add(match[1]!)
  }
  return [...found]
}

describe("command catalog", () => {
  test("covers exactly the commands the protocol declares", () => {
    const declared = declaredCommandTypes()
    expect(declared.length).toBeGreaterThan(100)
    const cataloged = Object.keys(COMMAND_CATALOG)
    expect(declared.filter((type) => !cataloged.includes(type))).toEqual([])
    expect(cataloged.filter((type) => !declared.includes(type))).toEqual([])
  })

  test("every entry has a summary, a params signature, a risk and a domain", () => {
    for (const [type, entry] of Object.entries(COMMAND_CATALOG)) {
      expect(entry.summary.length, `${type} summary`).toBeGreaterThan(0)
      expect(entry.params.length, `${type} params`).toBeGreaterThan(0)
      expect(VALID_RISKS, `${type} risk`).toContain(entry.risk)
      expect(type.startsWith(`${entry.domain}.`), `${type} domain`).toBe(true)
    }
  })

  test("listCommandCatalog filters by domain and sorts by type", () => {
    const chat = listCommandCatalog("chat")
    expect(chat.length).toBeGreaterThan(10)
    expect(chat.every((entry) => entry.type.startsWith("chat."))).toBe(true)
    const types = chat.map((entry) => entry.type)
    expect(types).toEqual([...types].sort())
    expect(listCommandCatalog().length).toBe(Object.keys(COMMAND_CATALOG).length)
  })

  test("isCatalogedCommandType accepts known types and rejects others", () => {
    expect(isCatalogedCommandType("system.ping")).toBe(true)
    expect(isCatalogedCommandType("system.nope")).toBe(false)
  })
})
