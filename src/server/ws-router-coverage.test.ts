import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { COMMAND_REGISTRY } from "../shared/commands"

const SERVER_DIR = import.meta.dir

const HANDLER_FILES = readdirSync(SERVER_DIR)
  .filter((name) => name.startsWith("ws-router") && name.endsWith(".ts") && !name.includes(".test."))

function readSource(name: string): string {
  return readFileSync(join(SERVER_DIR, name), "utf8")
}

function declaredCommandTypes(): readonly string[] {
  return COMMAND_REGISTRY.map((definition) => definition.type)
}

function handledCommandTypes(): { exact: ReadonlySet<string>; prefixes: readonly string[] } {
  const exact = new Set<string>()
  const prefixes: string[] = []
  for (const name of HANDLER_FILES) {
    const source = readSource(name)
    for (const match of source.matchAll(/case "([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) exact.add(match[1]!)
    for (const match of source.matchAll(/command\.type (?:===|!==) "([a-zA-Z]+(?:\.[a-zA-Z]+)+)"/g)) exact.add(match[1]!)
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
