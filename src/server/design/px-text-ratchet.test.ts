import { describe, expect, test } from "bun:test"
import { readdirSync } from "node:fs"
import { join } from "node:path"

const CAP = 0

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

    expect(filesWalked).toBeGreaterThan(MIN_FILES_WALKED)

    expect(count).toBeLessThanOrEqual(CAP)
  })
})
