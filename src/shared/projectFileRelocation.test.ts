import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile, readFile, access } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { relocateExternalFileIntoProject, RELOCATED_OUTPUT_DIR } from "./projectFileRelocation"

describe("relocateExternalFileIntoProject", () => {
  let projectRoot: string
  let externalRoot: string

  beforeEach(async () => {
    projectRoot = await mkdtemp(join(tmpdir(), "kanna-project-"))
    externalRoot = await mkdtemp(join(tmpdir(), "kanna-codex-"))
  })

  afterEach(async () => {
    await rm(projectRoot, { recursive: true, force: true })
    await rm(externalRoot, { recursive: true, force: true })
  })

  test("relative path is returned unchanged", () => {
    const result = relocateExternalFileIntoProject("generated_images/x.png", projectRoot)
    expect(result).toEqual({ relativePath: "generated_images/x.png", relocated: false })
  })

  test("absolute path inside project root is no-op", async () => {
    const insidePath = join(projectRoot, "outputs", "img.png")
    await mkdir(join(projectRoot, "outputs"), { recursive: true })
    await writeFile(insidePath, "x")
    const result = relocateExternalFileIntoProject(insidePath, projectRoot)
    expect(result).toEqual({ relativePath: insidePath, relocated: false })
  })

  test("external absolute path is copied into .kanna/outputs and returned project-relative", async () => {
    const source = join(externalRoot, "ig_abc.png")
    await writeFile(source, "image-bytes")

    const result = relocateExternalFileIntoProject(source, projectRoot)

    expect(result.relocated).toBe(true)
    expect(result.relativePath).toBe(`${RELOCATED_OUTPUT_DIR}/ig_abc.png`)
    const destAbsolute = join(projectRoot, result.relativePath)
    await access(destAbsolute)
    expect(await readFile(destAbsolute, "utf8")).toBe("image-bytes")
  })

  test("collision appends numeric suffix", async () => {
    const source1 = join(externalRoot, "dup.png")
    const source2 = join(externalRoot, "sub", "dup.png")
    await mkdir(join(externalRoot, "sub"), { recursive: true })
    await writeFile(source1, "first")
    await writeFile(source2, "second")

    const first = relocateExternalFileIntoProject(source1, projectRoot)
    const second = relocateExternalFileIntoProject(source2, projectRoot)

    expect(first.relativePath).toBe(`${RELOCATED_OUTPUT_DIR}/dup.png`)
    expect(second.relativePath).toBe(`${RELOCATED_OUTPUT_DIR}/dup-1.png`)
    expect(await readFile(join(projectRoot, second.relativePath), "utf8")).toBe("second")
  })

  test("missing source file falls back to input path", () => {
    const ghost = join(externalRoot, "does-not-exist.png")
    const result = relocateExternalFileIntoProject(ghost, projectRoot)
    expect(result).toEqual({ relativePath: ghost, relocated: false })
  })

  test("empty path is no-op", () => {
    const result = relocateExternalFileIntoProject("", projectRoot)
    expect(result).toEqual({ relativePath: "", relocated: false })
  })
})
