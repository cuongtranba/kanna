import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { $ } from "bun"
import { clearProjectPathCache, listProjectPaths } from "./project-paths"

const tempDirs: string[] = []

beforeEach(() => {
  clearProjectPathCache()
})

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), prefix))
  tempDirs.push(dir)
  return dir
}

describe("listProjectPaths", () => {
  test("empty query returns top-level entries with dirs suffixed", async () => {
    const root = await makeTempDir("kanna-paths-empty-")
    await writeFile(path.join(root, "a.txt"), "a")
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "b.ts"), "b")

    const paths = await listProjectPaths({ projectId: "p1", localPath: root, query: "" })
    const names = paths.map((p) => p.path).sort()
    expect(names).toEqual(["a.txt", "src/"])
    expect(paths.find((p) => p.path === "src/")?.kind).toBe("dir")
    expect(paths.find((p) => p.path === "a.txt")?.kind).toBe("file")
  })

  test("git repo: returns tracked files + derived dirs", async () => {
    const root = await makeTempDir("kanna-paths-git-")
    await $`git init -q`.cwd(root)
    await $`git -c user.email=t@t -c user.name=t commit -q --allow-empty -m init`.cwd(root)
    await mkdir(path.join(root, "src"))
    await writeFile(path.join(root, "src", "agent.ts"), "x")
    await writeFile(path.join(root, "README.md"), "r")
    await $`git add .`.cwd(root)
    await $`git -c user.email=t@t -c user.name=t commit -q -m add`.cwd(root)

    const paths = await listProjectPaths({ projectId: "p2", localPath: root, query: "agent" })
    const names = paths.map((p) => p.path)
    expect(names).toContain("src/agent.ts")
  })

  test("git repo: respects .gitignore for untracked files", async () => {
    const root = await makeTempDir("kanna-paths-ignore-")
    await $`git init -q`.cwd(root)
    await writeFile(path.join(root, ".gitignore"), "node_modules\n")
    await mkdir(path.join(root, "node_modules"))
    await writeFile(path.join(root, "node_modules", "junk.js"), "x")
    await writeFile(path.join(root, "app.ts"), "x")

    const paths = await listProjectPaths({ projectId: "p3", localPath: root, query: "junk" })
    expect(paths.map((p) => p.path)).not.toContain("node_modules/junk.js")
  })

  test("fuzzy ranking: prefix matches before substring matches", async () => {
    const root = await makeTempDir("kanna-paths-rank-")
    await writeFile(path.join(root, "review.ts"), "")
    await writeFile(path.join(root, "unreview.ts"), "")

    const paths = await listProjectPaths({ projectId: "p4", localPath: root, query: "rev" })
    expect(paths.map((p) => p.path)).toEqual(["review.ts", "unreview.ts"])
  })

  test("respects limit", async () => {
    const root = await makeTempDir("kanna-paths-limit-")
    for (let i = 0; i < 10; i++) {
      await writeFile(path.join(root, `file-${i}.txt`), "")
    }

    const paths = await listProjectPaths({ projectId: "p5", localPath: root, query: "file", limit: 3 })
    expect(paths.length).toBe(3)
  })

  test("cache returns from memory on repeat call", async () => {
    const root = await makeTempDir("kanna-paths-cache-")
    await writeFile(path.join(root, "a.txt"), "")

    const first = await listProjectPaths({ projectId: "p6", localPath: root, query: "a" })
    await writeFile(path.join(root, "b.txt"), "") // added after first call
    const second = await listProjectPaths({ projectId: "p6", localPath: root, query: "b" })

    expect(first.map((p) => p.path)).toContain("a.txt")
    expect(second.map((p) => p.path)).not.toContain("b.txt")
  })
})
