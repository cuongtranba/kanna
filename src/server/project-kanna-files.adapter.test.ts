import { afterEach, expect, test } from "bun:test"
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { removeProjectKannaFiles } from "./project-kanna-files.adapter"

const roots: string[] = []

function projectWith(files: readonly string[]): string {
  const parent = mkdtempSync(path.join(tmpdir(), "kanna-project-files-"))
  roots.push(parent)
  const root = path.join(parent, "app")
  for (const file of files) {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), "x")
  }
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

test("removes Kanna's uploads, outputs, exports and emptied worktree folder, and leaves the user's files alone", async () => {
  const root = projectWith([
    "src/index.ts",
    ".kanna/uploads/screenshot.png",
    ".kanna/outputs/report.md",
    ".kanna/exports/chat.md",
  ])
  mkdirSync(path.join(root, "..", ".kanna-worktrees", "app"), { recursive: true })

  await removeProjectKannaFiles(root)

  expect(existsSync(path.join(root, "src/index.ts"))).toBe(true)
  expect(existsSync(path.join(root, ".kanna"))).toBe(false)
  expect(existsSync(path.join(root, "..", ".kanna-worktrees"))).toBe(false)
})

test("keeps .kanna when something other than Kanna's own folders lives in it", async () => {
  const root = projectWith([".kanna/uploads/a.png", ".kanna/notes.md"])

  await removeProjectKannaFiles(root)

  expect(existsSync(path.join(root, ".kanna/uploads"))).toBe(false)
  expect(existsSync(path.join(root, ".kanna/notes.md"))).toBe(true)
})
