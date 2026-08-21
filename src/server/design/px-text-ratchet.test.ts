import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

// CAP only ever goes DOWN. Never raise it. The typography-scale card drove it to 0.
const CAP = 0

// The walker must never be able to satisfy `count <= CAP` by globbing nothing.
// At CAP = 0 the old `count > 0` vacuity guard is dead, so coverage is asserted
// directly instead: src/client holds hundreds of .ts/.tsx sources, so a walker
// that resolves the wrong directory (or silently returns an empty list) fails
// here rather than reporting a false zero.
const MIN_FILES_WALKED = 100

const CLIENT_DIR = join(import.meta.dir, "../../..", "src/client")
const PX_TEXT_PATTERN = /text-\[\d+px\]/g

function listSourceFiles(dir: string): string[] {
  const files: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      files.push(...listSourceFiles(full))
    } else if (entry.isFile() && /\.tsx?$/.test(entry.name)) {
      files.push(full)
    }
  }
  return files
}

async function countArbitraryPxTextUtilities(): Promise<{ count: number; filesWalked: number }> {
  const files = listSourceFiles(CLIENT_DIR)
  let count = 0
  for (const file of files) {
    const content = await Bun.file(file).text()
    const matches = content.match(PX_TEXT_PATTERN)
    count += matches?.length ?? 0
  }
  return { count, filesWalked: files.length }
}

describe("px-text ratchet — arbitrary-px text utilities under src/client", () => {
  test(`count never rises above CAP (${CAP})`, async () => {
    const { count, filesWalked } = await countArbitraryPxTextUtilities()

    // Anti-vacuity: prove the walker actually read the client tree before
    // trusting its zero.
    expect(filesWalked).toBeGreaterThan(MIN_FILES_WALKED)

    expect(count).toBeLessThanOrEqual(CAP)
  })
})
