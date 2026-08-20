import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

// CAP only ever goes DOWN. Never raise it. The typography-scale card drives it to 0.
const CAP = 169

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

async function countArbitraryPxTextUtilities(): Promise<number> {
  let count = 0
  for (const file of listSourceFiles(CLIENT_DIR)) {
    const content = await Bun.file(file).text()
    const matches = content.match(PX_TEXT_PATTERN)
    count += matches?.length ?? 0
  }
  return count
}

describe("px-text ratchet — arbitrary-px text utilities under src/client", () => {
  test(`count never rises above CAP (${CAP})`, async () => {
    const count = await countArbitraryPxTextUtilities()

    // Vacuity guard: while CAP > 0, a count of 0 means the walker silently
    // globbed nothing, which would make the <= CAP assertion pass without
    // proving anything. Drop this guard only when Task 16 sets CAP = 0.
    if (CAP > 0) {
      expect(count).toBeGreaterThan(0)
    }

    expect(count).toBeLessThanOrEqual(CAP)
  })
})
