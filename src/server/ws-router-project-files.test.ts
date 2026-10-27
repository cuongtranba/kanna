import { afterEach, describe, expect, test } from "vite-plus/test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import type { ClientCommand, ServerEnvelope } from "../shared/protocol"
import { handleProjectPathsCommand, handleUploadDeleteCommand } from "./ws-router-project-files"
import { listProjectPaths } from "./project-paths"
import { deleteProjectUpload, persistProjectUpload } from "./uploads"

const tempDirs: string[] = []

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function openProject() {
  const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-files-"))
  tempDirs.push(projectDir)
  const project = { id: "project-1", localPath: projectDir }
  const sent: ServerEnvelope[] = []
  async function run(command: ClientCommand): Promise<ServerEnvelope> {
    const store = { getProject: (projectId: string) => (projectId === project.id ? project : null) }
    const send = (envelope: ServerEnvelope) => { sent.push(envelope) }
    const handled = command.type === "project.listPaths"
      ? await handleProjectPathsCommand(store, listProjectPaths, send, command, "request-1")
      : await handleUploadDeleteCommand(store, deleteProjectUpload, send, command, "request-1")
    expect(handled).toBe(true)
    const [reply] = sent.splice(0)
    if (!reply) throw new Error("the handler claimed the command but sent nothing")
    return reply
  }
  return { projectDir, project, run }
}

function pathsOf(reply: ServerEnvelope): string[] {
  if (reply.type !== "ack" || typeof reply.result !== "object" || reply.result === null) return []
  const paths = "paths" in reply.result ? reply.result.paths : []
  return Array.isArray(paths) ? paths.map((entry) => entry.path) : []
}

describe("project.listPaths", () => {
  test("is an error for an unknown project", async () => {
    const { run } = await openProject()
    await expect(run({ type: "project.listPaths", projectId: "does-not-exist" })).rejects.toThrow("Project not found")
  })

  test("lists the top-level entries for an empty query", async () => {
    const { projectDir, run } = await openProject()
    await mkdir(path.join(projectDir, "src"))
    await writeFile(path.join(projectDir, "README.md"), "")

    const names = pathsOf(await run({ type: "project.listPaths", projectId: "project-1" }))

    expect(names).toContain("README.md")
    expect(names).toContain("src/")
  })

  test("ranks by the query and honours the limit", async () => {
    const { projectDir, run } = await openProject()
    for (let i = 0; i < 5; i++) await writeFile(path.join(projectDir, `file-${i}.txt`), "")

    const names = pathsOf(await run({ type: "project.listPaths", projectId: "project-1", query: "file", limit: 2 }))

    expect(names.length).toBe(2)
  })
})

describe("upload.delete", () => {
  async function storeUpload(projectDir: string, fileName: string) {
    return persistProjectUpload({
      projectId: "project-1",
      localPath: projectDir,
      fileName,
      bytes: new TextEncoder().encode("bye"),
      fallbackMimeType: "text/plain",
    })
  }

  test("removes a stored upload and reports it deleted", async () => {
    const { projectDir, run } = await openProject()
    const attachment = await storeUpload(projectDir, "bye.txt")

    const reply = await run({ type: "upload.delete", projectId: "project-1", storedName: "bye.txt" })

    expect(reply).toMatchObject({ type: "ack", result: { deleted: true } })
    expect(await Bun.file(attachment.absolutePath).exists()).toBe(false)
  })

  test("deletes a file literally named tus, which the tus route used to shadow", async () => {
    const { projectDir, run } = await openProject()
    const attachment = await storeUpload(projectDir, "tus")

    const reply = await run({ type: "upload.delete", projectId: "project-1", storedName: "tus" })

    expect(reply).toMatchObject({ type: "ack", result: { deleted: true } })
    expect(await Bun.file(attachment.absolutePath).exists()).toBe(false)
  })

  test("refuses a name that would leave the upload folder and keeps the file", async () => {
    const { projectDir, run } = await openProject()
    const outside = path.join(projectDir, ".kanna", "outside.txt")
    await storeUpload(projectDir, "bye.txt")
    await writeFile(outside, "keep me")

    for (const storedName of ["../outside.txt", "a/b.txt", "..", "."]) {
      await expect(run({ type: "upload.delete", projectId: "project-1", storedName })).rejects.toThrow("Invalid attachment path")
    }

    expect(await Bun.file(outside).exists()).toBe(true)
  })

  test("is an error for an unknown project", async () => {
    const { run } = await openProject()
    await expect(run({ type: "upload.delete", projectId: "no-such-project", storedName: "bye.txt" })).rejects.toThrow("Project not found")
  })
})
