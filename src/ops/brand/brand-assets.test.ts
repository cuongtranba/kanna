import { expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

const ROOT = join(import.meta.dir, "../../..")
const SOURCE_MARK = "assets/logo.svg"
const MARK_COPIES = ["public/icon.svg", "wiki/src/assets/logo.svg", "wiki/public/favicon.svg"]

function read(path: string): string {
  return readFileSync(join(ROOT, path), "utf8")
}

test("every shipped copy of the Kanna mark is the README mark's vector, byte for byte", () => {
  const source = read(SOURCE_MARK)
  const drifted = MARK_COPIES.filter((path) => read(path) !== source)
  expect(drifted).toEqual([])
})
