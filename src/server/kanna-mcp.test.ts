import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { resolveOfferDownload } from "./kanna-mcp"

let tempRoot: string

beforeAll(async () => {
  tempRoot = await mkdtemp(path.join(os.tmpdir(), "kanna-mcp-"))
  await mkdir(path.join(tempRoot, "dist"), { recursive: true })
  await writeFile(path.join(tempRoot, "dist", "build.zip"), "binary contents")
  await writeFile(path.join(tempRoot, "report.pdf"), "%PDF-1.4")
})

afterAll(async () => {
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true })
})

describe("resolveOfferDownload", () => {
  test("returns content URL + metadata for a valid project file", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist/build.zip", label: "Latest build" },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl).toBe("/api/projects/p1/files/dist/build.zip/content")
    expect(result.payload.fileName).toBe("build.zip")
    expect(result.payload.displayName).toBe("Latest build")
    expect(result.payload.relativePath).toBe("dist/build.zip")
    expect(result.payload.size).toBeGreaterThan(0)
    expect(result.payload.mimeType).toBeTruthy()
  })

  test("falls back to file name when label missing", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "report.pdf" },
    )

    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.displayName).toBe("report.pdf")
    expect(result.payload.mimeType).toBeTruthy()
  })

  test("rejects absolute paths", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "/etc/passwd" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects parent-relative escape paths", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "../../etc/hosts" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects directories", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "dist" },
    )
    expect(result.ok).toBe(false)
  })

  test("rejects missing files", async () => {
    const result = await resolveOfferDownload(
      { projectId: "p1", localPath: tempRoot },
      { path: "missing.txt" },
    )
    expect(result.ok).toBe(false)
  })

  test("URL-encodes project ID with special characters", async () => {
    const result = await resolveOfferDownload(
      { projectId: "proj 1/extra", localPath: tempRoot },
      { path: "report.pdf" },
    )
    expect(result.ok).toBe(true)
    if (!result.ok) throw new Error("expected ok")
    expect(result.payload.contentUrl.startsWith("/api/projects/proj%201%2Fextra/files/")).toBe(true)
  })
})
