import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const MODULE_MOCK = /\bmock\s*\.\s*module\s*\(/

const REMEDY =
  "a bun module mock rewrites the process-wide registry and outlives its test file, " +
  "so a factory that omits an export can kill an unrelated suite's import in " +
  "filesystem-dependent order — the class that intermittently failed CI and blocked " +
  "the v1.58.0 publish. Inject the dependency as a parameter with the production " +
  'default instead; see CLAUDE.md "Module mocks are banned".'

const LEGACY_MODULE_MOCKS = new Set([
  "src/client/components/lexical/markdown/MessageCodeBlock.test.tsx",
  "src/client/components/lexical/markdown/renderMessage.test.tsx",
  "src/client/components/messages/ExitPlanModeMessage.test.tsx",
  "src/client/components/messages/MermaidDiagram.test.tsx",
  "src/client/components/messages/SubagentTaskMessage.test.tsx",
  "src/client/components/messages/TextMessage.test.tsx",
  "src/client/components/messages/ThinkingMessage.test.tsx",
  "src/client/components/messages/file-preview/bodies/CodeBody.test.tsx",
  "src/client/components/messages/file-preview/bodies/textBodies.test.tsx",
  "src/client/components/messages/shared.test.tsx",
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
  const root = join(import.meta.dir, "../../..")

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
