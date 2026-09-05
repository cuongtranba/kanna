import { describe, expect, test } from "bun:test"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"

const RAW_INK = /\btext-(warning|info|success)(?![a-z-])/g

const VERBATIM_EXCEPTION = new Set(["src/client/components/messages/FileContentView.tsx"])

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (/\.tsx?$/.test(name) && !name.includes(".test.")) out.push(full)
  }
  return out
}

describe("raw semantic tokens are never used as ink", () => {
  const root = join(import.meta.dir, "../../..")

  test("no client or shared source paints text with a raw semantic token", () => {
    const offenders: string[] = []
    for (const dir of ["src/client", "src/shared"]) {
      for (const file of walk(join(root, dir))) {
        const rel = file.slice(root.length + 1).replaceAll("\\", "/")
        if (VERBATIM_EXCEPTION.has(rel)) continue
        const hits = readFileSync(file, "utf8").match(RAW_INK)
        if (hits) offenders.push(`${rel}: ${hits.join(", ")}`)
      }
    }
    expect(offenders).toEqual([])
  })

  test("the exception list stays honest — every entry still needs it", () => {
    for (const rel of VERBATIM_EXCEPTION) {
      const source = readFileSync(join(root, rel), "utf8")
      expect(source).toMatch(RAW_INK)
    }
  })
})
