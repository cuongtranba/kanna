import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

const SERVER_DIR = import.meta.dir

const HANDLER_FILES = readdirSync(SERVER_DIR)
  .filter((name) => name.startsWith("ws-router") && name.endsWith(".ts") && !name.includes(".test."))

function readSource(name: string): string {
  return readFileSync(join(SERVER_DIR, name), "utf8")
}

function unionBody(source: string, unionName: string): string {
  const start = source.indexOf(`export type ${unionName} =`)
  if (start < 0) throw new Error(`union ${unionName} not found`)
  const rest = source.slice(start + `export type ${unionName} =`.length)
  const end = rest.search(/\nexport (?:type|interface|const|function) /)
  return end < 0 ? rest : rest.slice(0, end)
}

function declaredCommandTypes(): readonly string[] {
  const protocol = readFileSync(join(SERVER_DIR, "..", "shared", "protocol.ts"), "utf8")
  const shareProtocol = readFileSync(
    join(SERVER_DIR, "..", "shared", "session-share", "protocol.ts"),
    "utf8",
  )
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
  return [...found]
}

function handledCommandTypes(): { exact: ReadonlySet<string>; prefixes: readonly string[] } {
  const exact = new Set<string>()
  const prefixes: string[] = []
  for (const name of HANDLER_FILES) {
    const source = readSource(name)
    for (const match of source.matchAll(/case "([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) exact.add(match[1]!)
    for (const match of source.matchAll(/command\.type === "([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) exact.add(match[1]!)
    for (const match of source.matchAll(/^\s{2}"([a-zA-Z]+(?:\.[a-zA-Z]+)+)",$/gm)) exact.add(match[1]!)
    for (const match of source.matchAll(/startsWith\("([a-zA-Z]+\.)"\)/g)) prefixes.push(match[1]!)
  }
  return { exact, prefixes }
}

describe("ws-router command coverage", () => {
  test("the protocol and the handlers are both discoverable", () => {
    expect(HANDLER_FILES.length).toBeGreaterThan(5)
    expect(declaredCommandTypes().length).toBeGreaterThan(100)
  })

  test("every declared client command is handled by some ws-router module", () => {
    const declared = declaredCommandTypes()
    const { exact, prefixes } = handledCommandTypes()
    const unhandled = declared.filter(
      (type) => !exact.has(type) && !prefixes.some((prefix) => type.startsWith(prefix)),
    )
    expect(unhandled).toEqual([])
  })
})
