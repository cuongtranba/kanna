import { describe, expect, test } from "vite-plus/test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const MODULE_MOCK = /\bvi\s*\.\s*(?:mock|doMock)\s*\(/

const REMEDY =
  "a module mock substitutes the module for every importer in its test file and hides " +
  "a real dependency breaking, so it keeps passing when the real collaborator breaks. " +
  "Inject the dependency as a parameter with the production default instead; " +
  'see the kanna-test skill.'

const LEGACY_MODULE_MOCKS = new Set([
  "src/client/components/messages/MermaidDiagram.test.tsx",
  "src/client/components/messages/file-preview/bodies/CodeBody.test.tsx",
  "src/server/claude-session-start.test.ts",
])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name)) out.push(full)
  }
  return out
}

describe("module mocks are banned outside the shrinking legacy list", () => {
  const root = join(import.meta.dirname, "../../..")

  test("no file outside the legacy list registers a module mock", () => {
    const offenders: string[] = []
    for (const file of walk(join(root, "src"))) {
      const rel = file.slice(root.length + 1).replaceAll("\\", "/")
      if (LEGACY_MODULE_MOCKS.has(rel)) continue
      if (MODULE_MOCK.test(readFileSync(file, "utf8"))) {
        offenders.push(`${rel} — ${REMEDY}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("the legacy list stays honest — a converted file must delete its entry in the same PR", () => {
    for (const rel of LEGACY_MODULE_MOCKS) {
      const source = readFileSync(join(root, rel), "utf8")
      expect(source).toMatch(MODULE_MOCK)
    }
  })
})
