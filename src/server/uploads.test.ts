import { afterEach, describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { mkdtemp, readdir, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { deleteProjectUpload, inferAttachmentContentType, persistProjectUpload } from "./uploads"
import { getProjectUploadDir } from "./paths"
import type { UploadedAttachment } from "../shared/types"
import { startKannaServer } from "./server"

const PNG_BASE64 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+yF9sAAAAASUVORK5CYII="

const tempDirs: string[] = []

const MIB = 1024 * 1024
const TUS_VERSION = "1.0.0"

function patternBytes(size: number) {
  return new Uint8Array(size).map((_, index) => (index * 31 + 7) % 251)
}

function sha256(bytes: Uint8Array) {
  return createHash("sha256").update(bytes).digest("hex")
}

function tusHeaders(extra: Record<string, string> = {}) {
  return { "Tus-Resumable": TUS_VERSION, ...extra }
}

async function createTusUpload(base: string, projectId: string, args: { size: number; filename: string; filetype?: string }) {
  const metadata = [`filename ${btoa(args.filename)}`, ...(args.filetype ? [`filetype ${btoa(args.filetype)}`] : [])].join(",")
  const response = await fetch(`${base}/api/projects/${projectId}/uploads/tus`, {
    method: "POST",
    headers: tusHeaders({ "Upload-Length": String(args.size), "Upload-Metadata": metadata }),
  })
  return { response, url: response.headers.get("location") ? `${base}${response.headers.get("location")}` : "" }
}

async function patchTusChunk(url: string, offset: number, chunk: Uint8Array<ArrayBuffer>) {
  return fetch(url, {
    method: "PATCH",
    headers: tusHeaders({ "Upload-Offset": String(offset), "Content-Type": "application/offset+octet-stream" }),
    body: chunk,
  })
}

async function uploadThroughTus(base: string, projectId: string, args: { filename: string; bytes: Uint8Array; chunkSize: number }) {
  const created = await createTusUpload(base, projectId, { size: args.bytes.byteLength, filename: args.filename })
  expect(created.response.status).toBe(201)
  let offset = 0
  let last = created.response
  while (offset < args.bytes.byteLength) {
    last = await patchTusChunk(created.url, offset, args.bytes.slice(offset, offset + args.chunkSize))
    offset = Number(last.headers.get("upload-offset"))
  }
  const finish: { attachments: UploadedAttachment[] } = await last.json()
  return finish.attachments[0]!
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

async function startIsolatedServer(options: { port: number; strictPort?: boolean }) {
  const dataDir = await mkdtemp(path.join(tmpdir(), "kanna-server-data-"))
  tempDirs.push(dataDir)
  return startKannaServer({
    dataDir,
    port: options.port,
    strictPort: options.strictPort ?? false,
    discoverProjects: () => [],
  })
}

describe("uploads", () => {
  test("stores uploads in .kanna/uploads and keeps duplicate filenames", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-test-"))
    tempDirs.push(projectDir)

    const first = await persistProjectUpload({
      projectId: "project-1",
      localPath: projectDir,
      fileName: "notes.txt",
      bytes: new TextEncoder().encode("hello"),
      fallbackMimeType: "text/plain",
    })
    const second = await persistProjectUpload({
      projectId: "project-1",
      localPath: projectDir,
      fileName: "notes.txt",
      bytes: new TextEncoder().encode("world"),
      fallbackMimeType: "text/plain",
    })

    expect(first.absolutePath).toBe(path.join(projectDir, ".kanna/uploads/notes.txt"))
    expect(first.relativePath).toBe("./.kanna/uploads/notes.txt")
    expect(first.contentUrl).toBe("/api/projects/project-1/uploads/notes.txt/content")
    expect(second.absolutePath).toBe(path.join(projectDir, ".kanna/uploads/notes-1.txt"))
    expect(second.relativePath).toBe("./.kanna/uploads/notes-1.txt")
    expect(second.contentUrl).toBe("/api/projects/project-1/uploads/notes-1.txt/content")
    expect(await Bun.file(path.join(projectDir, ".kanna/uploads/notes.txt")).text()).toBe("hello")
    expect(await Bun.file(path.join(projectDir, ".kanna/uploads/notes-1.txt")).text()).toBe("world")
  })

  test("stores concurrent same-name uploads without overwriting existing content", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-concurrent-"))
    tempDirs.push(projectDir)

    const attachments = await Promise.all([
      persistProjectUpload({
        projectId: "project-1",
        localPath: projectDir,
        fileName: "notes.txt",
        bytes: new TextEncoder().encode("first"),
        fallbackMimeType: "text/plain",
      }),
      persistProjectUpload({
        projectId: "project-1",
        localPath: projectDir,
        fileName: "notes.txt",
        bytes: new TextEncoder().encode("second"),
        fallbackMimeType: "text/plain",
      }),
      persistProjectUpload({
        projectId: "project-1",
        localPath: projectDir,
        fileName: "notes.txt",
        bytes: new TextEncoder().encode("third"),
        fallbackMimeType: "text/plain",
      }),
    ])

    const storedNames = attachments.map((attachment) => path.basename(attachment.absolutePath)).sort()
    expect(storedNames).toEqual(["notes-1.txt", "notes-2.txt", "notes.txt"])

    const contents = await Promise.all(attachments.map((attachment) => Bun.file(attachment.absolutePath).text()))
    expect(new Set(contents)).toEqual(new Set(["first", "second", "third"]))
  })

  test("transliterates Vietnamese letters instead of dropping them", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-vietnamese-"))
    tempDirs.push(projectDir)

    const upload = (fileName: string, body: string) =>
      persistProjectUpload({
        projectId: "project-1",
        localPath: projectDir,
        fileName,
        bytes: new TextEncoder().encode(body),
        fallbackMimeType: "text/plain",
      })

    const salary = await upload("CP LƯƠNG T8.2026.xlsx", "salary")
    const dStroke = await upload("ĐÀO đạt.txt", "d-stroke")
    const cjkOnly = await upload("報告.xlsx", "cjk")

    expect(salary.relativePath).toBe("./.kanna/uploads/CP-LUONG-T8.2026.xlsx")
    expect(salary.displayName).toBe("CP LƯƠNG T8.2026.xlsx")
    expect(dStroke.relativePath).toBe("./.kanna/uploads/DAO-dat.txt")
    expect(cjkOnly.relativePath).toBe("./.kanna/uploads/upload.xlsx")
  })

  test("reuses an existing file holding identical bytes instead of minting a copy", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-reuse-"))
    tempDirs.push(projectDir)

    const upload = (body: string) =>
      persistProjectUpload({
        projectId: "project-1",
        localPath: projectDir,
        fileName: "report.txt",
        bytes: new TextEncoder().encode(body),
        fallbackMimeType: "text/plain",
      })

    const first = await upload("same bytes")
    const repeat = await upload("same bytes")
    const different = await upload("other bytes")

    expect(first.reused).toBeUndefined()
    expect(repeat.reused).toBe(true)
    expect(repeat.relativePath).toBe(first.relativePath)
    expect(different.reused).toBeUndefined()
    expect(different.relativePath).toBe("./.kanna/uploads/report-1.txt")
    expect((await readdir(getProjectUploadDir(projectDir))).sort()).toEqual(["report-1.txt", "report.txt"])
  })

  test("detects image uploads and returns absolute plus project-relative paths", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-image-"))
    tempDirs.push(projectDir)

    const attachment = await persistProjectUpload({
      projectId: "project-2",
      localPath: projectDir,
      fileName: "pixel.png",
      bytes: Buffer.from(PNG_BASE64, "base64"),
    })

    expect(attachment.kind).toBe("image")
    expect(attachment.mimeType).toBe("image/png")
    expect(getProjectUploadDir(projectDir)).toBe(path.join(projectDir, ".kanna", "uploads"))
    expect(attachment.absolutePath).toBe(path.join(projectDir, ".kanna/uploads/pixel.png"))
    expect(attachment.relativePath).toBe("./.kanna/uploads/pixel.png")
    expect(attachment.contentUrl).toBe("/api/projects/project-2/uploads/pixel.png/content")
  })

  test("serves uploaded attachment content through the project content URL", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4310 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "hello.txt",
        bytes: new TextEncoder().encode("hello from upload"),
        fallbackMimeType: "text/plain",
      })

      const response = await fetch(`http://localhost:${server.port}${attachment.contentUrl}`)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(await response.text()).toBe("hello from upload")
    } finally {
      await server.stop()
    }
  })

  test("serves TypeScript uploads as text content", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-typescript-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4314 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "main.ts",
        bytes: new TextEncoder().encode("export const value = 1\n"),
        fallbackMimeType: "video/mp2t",
      })

      const response = await fetch(`http://localhost:${server.port}${attachment.contentUrl}`)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(await response.text()).toContain("export const value = 1")
    } finally {
      await server.stop()
    }
  })

  test("rejects non-GET requests for attachment content", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-content-method-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4312 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "hello.txt",
        bytes: new TextEncoder().encode("hello from upload"),
        fallbackMimeType: "text/plain",
      })

      const response = await fetch(`http://localhost:${server.port}${attachment.contentUrl}`, { method: "POST" })
      expect(response.status).toBe(405)
      expect(response.headers.get("allow")).toBe("GET, HEAD")
    } finally {
      await server.stop()
    }
  })

  test("HEAD probe on attachment content returns 200 with Content-Length and empty body", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-head-upload-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4322 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "hello.txt",
        bytes: new TextEncoder().encode("hello from upload"),
        fallbackMimeType: "text/plain",
      })

      const response = await fetch(`http://localhost:${server.port}${attachment.contentUrl}`, { method: "HEAD" })
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(response.headers.get("content-length")).toBe(String("hello from upload".length))
      expect(await response.text()).toBe("")
    } finally {
      await server.stop()
    }
  })

  test("serves project file content through GET and HEAD", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-file-content-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4323 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const relPath = "docs/readme.txt"
      const body = "project file body"
      await Bun.write(path.join(projectDir, relPath), body)

      const contentUrl = `/api/projects/${project.id}/files/${relPath}/content`

      const getResponse = await fetch(`http://localhost:${server.port}${contentUrl}`)
      expect(getResponse.status).toBe(200)
      expect(getResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(getResponse.headers.get("content-length")).toBe(String(body.length))
      expect(await getResponse.text()).toBe(body)

      const headResponse = await fetch(`http://localhost:${server.port}${contentUrl}`, { method: "HEAD" })
      expect(headResponse.status).toBe(200)
      expect(headResponse.headers.get("content-type")).toBe("text/plain; charset=utf-8")
      expect(headResponse.headers.get("content-length")).toBe(String(body.length))
      expect(await headResponse.text()).toBe("")

      const postResponse = await fetch(`http://localhost:${server.port}${contentUrl}`, { method: "POST" })
      expect(postResponse.status).toBe(405)
      expect(postResponse.headers.get("allow")).toBe("GET, HEAD")
    } finally {
      await server.stop()
    }
  })

  test("deletes uploaded attachments from the project uploads directory", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-upload-delete-"))
    tempDirs.push(projectDir)

    const attachment = await persistProjectUpload({
      projectId: "project-3",
      localPath: projectDir,
      fileName: "delete-me.txt",
      bytes: new TextEncoder().encode("bye"),
      fallbackMimeType: "text/plain",
    })

    const deleted = await deleteProjectUpload({
      localPath: projectDir,
      storedName: "delete-me.txt",
    })

    expect(deleted).toBe(true)
    expect(await Bun.file(attachment.absolutePath).exists()).toBe(false)
  })

  test("deletes uploaded attachment content through the project delete URL", async () => {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-project-delete-"))
    tempDirs.push(projectDir)

    const server = await startIsolatedServer({ port: 4311 })

    try {
      const project = await server.store.openProject(projectDir, "Project")
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "bye.txt",
        bytes: new TextEncoder().encode("delete over http"),
        fallbackMimeType: "text/plain",
      })

      const deleteUrl = `http://localhost:${server.port}${attachment.contentUrl.replace(/\/content$/, "")}`
      const response = await fetch(deleteUrl, { method: "DELETE" })
      expect(response.status).toBe(200)
      expect(await response.json()).toEqual({ ok: true })
      expect(await Bun.file(attachment.absolutePath).exists()).toBe(false)
    } finally {
      await server.stop()
    }
  })

  test("serves arbitrary local files via /api/local-file", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "kanna-local-file-"))
    tempDirs.push(dir)
    const filePath = path.join(dir, "hello.png")
    await Bun.write(filePath, Buffer.from(PNG_BASE64, "base64"))

    const server = await startIsolatedServer({ port: 4316 })

    try {
      const url = `http://localhost:${server.port}/api/local-file?path=${encodeURIComponent(filePath)}`
      const response = await fetch(url)
      expect(response.status).toBe(200)
      expect(response.headers.get("content-type")).toContain("image/")
      const contentLength = response.headers.get("content-length")
      expect(contentLength).not.toBeNull()
      expect(Number.parseInt(contentLength ?? "0", 10)).toBeGreaterThan(0)
      const bytes = new Uint8Array(await response.arrayBuffer())
      expect(bytes.length).toBeGreaterThan(0)

      const headResponse = await fetch(url, { method: "HEAD" })
      expect(headResponse.status).toBe(200)
      expect(headResponse.headers.get("content-length")).toBe(contentLength)
      expect(headResponse.headers.get("content-type")).toContain("image/")
    } finally {
      await server.stop()
    }
  })

  test("returns 404 for missing local files", async () => {
    const server = await startIsolatedServer({ port: 4317 })
    try {
      const response = await fetch(`http://localhost:${server.port}/api/local-file?path=${encodeURIComponent("/no/such/file.png")}`)
      expect(response.status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  test("rejects /api/local-file without path query parameter", async () => {
    const server = await startIsolatedServer({ port: 4318 })
    try {
      const response = await fetch(`http://localhost:${server.port}/api/local-file`)
      expect(response.status).toBe(400)
    } finally {
      await server.stop()
    }
  })

  test("infers text-friendly content types for previewable source files", () => {
    expect(inferAttachmentContentType("notes.txt")).toBe("text/plain; charset=utf-8")
    expect(inferAttachmentContentType("README.md")).toBe("text/markdown; charset=utf-8")
    expect(inferAttachmentContentType("main.ts", "video/mp2t")).toBe("text/plain; charset=utf-8")
    expect(inferAttachmentContentType("archive.zip", "application/zip")).toBe("application/zip")
  })

  test("infers image MIME types", () => {
    expect(inferAttachmentContentType("photo.png")).toBe("image/png")
    expect(inferAttachmentContentType("photo.jpg")).toBe("image/jpeg")
    expect(inferAttachmentContentType("photo.jpeg")).toBe("image/jpeg")
    expect(inferAttachmentContentType("photo.gif")).toBe("image/gif")
    expect(inferAttachmentContentType("photo.webp")).toBe("image/webp")
    expect(inferAttachmentContentType("icon.svg")).toBe("image/svg+xml")
    expect(inferAttachmentContentType("photo.avif")).toBe("image/avif")
  })

  test("infers application/pdf for .pdf", () => {
    expect(inferAttachmentContentType("doc.pdf")).toBe("application/pdf")
  })

  test("infers audio MIME types", () => {
    expect(inferAttachmentContentType("song.mp3")).toBe("audio/mpeg")
    expect(inferAttachmentContentType("song.wav")).toBe("audio/wav")
    expect(inferAttachmentContentType("song.m4a")).toBe("audio/mp4")
    expect(inferAttachmentContentType("song.ogg")).toBe("audio/ogg")
  })

  test("infers video MIME types", () => {
    expect(inferAttachmentContentType("clip.mp4")).toBe("video/mp4")
    expect(inferAttachmentContentType("clip.mov")).toBe("video/quicktime")
    expect(inferAttachmentContentType("clip.webm")).toBe("video/webm")
    expect(inferAttachmentContentType("clip.m4v")).toBe("video/mp4")
  })

  test("infers text/vnd.mermaid for .mmd and .mermaid", () => {
    expect(inferAttachmentContentType("diagram.mmd")).toBe("text/vnd.mermaid")
    expect(inferAttachmentContentType("diagram.mermaid")).toBe("text/vnd.mermaid")
  })

  test("returns octet-stream for unknown binary extensions and extensionless files", () => {
    expect(inferAttachmentContentType("archive.zip")).toBe("application/octet-stream")
    expect(inferAttachmentContentType("Makefile")).toBe("application/octet-stream")
    expect(inferAttachmentContentType("noext")).toBe("application/octet-stream")
  })
})

describe("resumable uploads (tus)", () => {
  async function startProject(prefix: string) {
    const projectDir = await mkdtemp(path.join(tmpdir(), prefix))
    tempDirs.push(projectDir)
    const server = await startIsolatedServer({ port: 0 })
    const project = await server.store.openProject(projectDir, "Project")
    return { server, project, projectDir, base: `http://localhost:${server.port}` }
  }

  test("a multi-chunk upload lands in .kanna/uploads with identical bytes and leaves no partial files behind", async () => {
    const { server, project, projectDir, base } = await startProject("kanna-tus-chunks-")
    try {
      const bytes = patternBytes(3 * MIB + 123)
      const attachment = await uploadThroughTus(base, project.id, { filename: "big file.bin", bytes, chunkSize: MIB })

      expect(attachment.relativePath).toBe("./.kanna/uploads/big-file.bin")
      expect(attachment.size).toBe(bytes.byteLength)
      expect(attachment.reused).toBeUndefined()
      const stored = new Uint8Array(await Bun.file(attachment.absolutePath).arrayBuffer())
      expect(sha256(stored)).toBe(sha256(bytes))
      const partialDir = path.join(getProjectUploadDir(projectDir), ".partial")
      let leftovers = await readdir(partialDir)
      for (let attempt = 0; attempt < 200 && leftovers.length > 0; attempt += 1) {
        leftovers = await readdir(partialDir)
      }
      expect(leftovers).toEqual([])

      const served = await fetch(`${base}${attachment.contentUrl}`)
      expect(served.status).toBe(200)
      expect(sha256(new Uint8Array(await served.arrayBuffer()))).toBe(sha256(bytes))
    } finally {
      await server.stop()
    }
  })

  test("an interrupted PATCH keeps its prefix and the upload continues from the reported offset", async () => {
    const { server, project, base } = await startProject("kanna-tus-resume-")
    try {
      const bytes = patternBytes(3 * MIB)
      const created = await createTusUpload(base, project.id, { size: bytes.byteLength, filename: "resume.bin" })
      expect(created.response.status).toBe(201)

      let sent = 0
      const cutBody = new ReadableStream<Uint8Array>({
        pull(controller) {
          if (sent >= MIB) {
            controller.error(new Error("connection lost"))
            return
          }
          controller.enqueue(bytes.slice(sent, sent + 64 * 1024))
          sent += 64 * 1024
        },
      })
      const interrupted = fetch(created.url, {
        method: "PATCH",
        headers: tusHeaders({ "Upload-Offset": "0", "Content-Type": "application/offset+octet-stream" }),
        body: cutBody,
      })
      await interrupted.then(undefined, () => undefined)

      let offset = 0
      for (let attempt = 0; attempt < 200 && offset === 0; attempt += 1) {
        const head = await fetch(created.url, { method: "HEAD", headers: tusHeaders() })
        offset = head.status === 200 ? Number(head.headers.get("upload-offset")) : 0
      }
      expect(offset).toBeGreaterThan(0)
      expect(offset).toBeLessThanOrEqual(MIB)

      const finished = await patchTusChunk(created.url, offset, bytes.slice(offset))
      const finish: { attachments: UploadedAttachment[] } = await finished.json()
      const stored = new Uint8Array(await Bun.file(finish.attachments[0]!.absolutePath).arrayBuffer())
      expect(sha256(stored)).toBe(sha256(bytes))
    } finally {
      await server.stop()
    }
  })

  test("a declared size over maxFileSizeMb is refused with 413 and the limit before any bytes are sent", async () => {
    const { server, project, base } = await startProject("kanna-tus-limit-")
    try {
      await server.appSettings.setUploads({ maxFileSizeMb: 1 })

      const refused = await createTusUpload(base, project.id, { size: 2 * MIB, filename: "two-mb.bin" })
      expect(refused.response.status).toBe(413)
      expect(await refused.response.json()).toEqual({ error: "File exceeds the 1 MB limit." })

      await server.appSettings.setUploads({ maxFileSizeMb: 10 })
      const allowed = await createTusUpload(base, project.id, { size: 2 * MIB, filename: "two-mb.bin" })
      expect(allowed.response.status).toBe(201)
    } finally {
      await server.stop()
    }
  })

  test("re-uploading identical bytes reuses the stored file while different bytes under the same name get a counter", async () => {
    const { server, project, projectDir, base } = await startProject("kanna-tus-reuse-")
    try {
      const bytes = patternBytes(MIB + 5)
      const first = await uploadThroughTus(base, project.id, { filename: "report.bin", bytes, chunkSize: MIB })
      const repeat = await uploadThroughTus(base, project.id, { filename: "report.bin", bytes, chunkSize: MIB })
      const different = await uploadThroughTus(base, project.id, { filename: "report.bin", bytes: patternBytes(MIB + 6), chunkSize: MIB })

      expect(first.reused).toBeUndefined()
      expect(repeat.reused).toBe(true)
      expect(repeat.relativePath).toBe(first.relativePath)
      expect(different.reused).toBeUndefined()
      expect(different.relativePath).toBe("./.kanna/uploads/report-1.bin")
      expect((await readdir(getProjectUploadDir(projectDir))).sort()).toEqual([".partial", "report-1.bin", "report.bin"])
    } finally {
      await server.stop()
    }
  })

  test("an empty file completes at creation and is stored", async () => {
    const { server, project, base } = await startProject("kanna-tus-empty-")
    try {
      const created = await createTusUpload(base, project.id, { size: 0, filename: "empty.txt", filetype: "text/plain" })
      expect(created.response.status).toBe(201)
      expect(created.url).not.toBe("")
      const finish: { attachments: UploadedAttachment[] } = await created.response.json()
      expect(finish.attachments[0]).toMatchObject({ relativePath: "./.kanna/uploads/empty.txt", size: 0, mimeType: "text/plain" })
    } finally {
      await server.stop()
    }
  })

  test("a stored file literally named tus is still served and deleted through the attachment routes", async () => {
    const { server, project, projectDir, base } = await startProject("kanna-tus-name-")
    try {
      const attachment = await persistProjectUpload({
        projectId: project.id,
        localPath: projectDir,
        fileName: "tus",
        bytes: new TextEncoder().encode("named tus"),
        fallbackMimeType: "text/plain",
      })
      const response = await fetch(`${base}${attachment.contentUrl}`)
      expect(response.status).toBe(200)
      expect(await response.text()).toBe("named tus")

      const deleted = await fetch(`${base}/api/projects/${project.id}/uploads/tus`, { method: "DELETE" })
      expect(await deleted.json()).toEqual({ ok: true })
      expect((await fetch(`${base}${attachment.contentUrl}`)).status).toBe(404)
    } finally {
      await server.stop()
    }
  })

  test("an upload without a filename is rejected with 400 and an unknown project with 404", async () => {
    const { server, project, base } = await startProject("kanna-tus-validation-")
    try {
      const nameless = await fetch(`${base}/api/projects/${project.id}/uploads/tus`, {
        method: "POST",
        headers: tusHeaders({ "Upload-Length": "10" }),
      })
      expect(nameless.status).toBe(400)
      expect(await nameless.json()).toEqual({ error: "Upload filename is required" })

      const missing = await createTusUpload(base, "nonexistent", { size: 10, filename: "a.txt" })
      expect(missing.response.status).toBe(404)
    } finally {
      await server.stop()
    }
  })
})

describe("content range requests", () => {
  const body = new TextEncoder().encode("0123456789".repeat(100))

  async function startWithAttachment() {
    const projectDir = await mkdtemp(path.join(tmpdir(), "kanna-range-"))
    tempDirs.push(projectDir)
    const server = await startIsolatedServer({ port: 0 })
    const project = await server.store.openProject(projectDir, "Project")
    const attachment = await persistProjectUpload({
      projectId: project.id,
      localPath: projectDir,
      fileName: "digits.txt",
      bytes: body,
      fallbackMimeType: "text/plain",
    })
    return { server, url: `http://localhost:${server.port}${attachment.contentUrl}` }
  }

  test("serves an exact byte range, a suffix range and an open-ended range as 206 with Content-Range", async () => {
    const { server, url } = await startWithAttachment()
    try {
      const middle = await fetch(url, { headers: { Range: "bytes=100-199" } })
      expect(middle.status).toBe(206)
      expect(middle.headers.get("content-range")).toBe("bytes 100-199/1000")
      expect(middle.headers.get("content-length")).toBe("100")
      expect(new Uint8Array(await middle.arrayBuffer())).toEqual(body.slice(100, 200))

      const suffix = await fetch(url, { headers: { Range: "bytes=-10" } })
      expect(suffix.status).toBe(206)
      expect(await suffix.text()).toBe("0123456789")

      const open = await fetch(url, { headers: { Range: "bytes=990-" } })
      expect(open.headers.get("content-range")).toBe("bytes 990-999/1000")
    } finally {
      await server.stop()
    }
  })

  test("an unsatisfiable range gets 416 and advertises the full size", async () => {
    const { server, url } = await startWithAttachment()
    try {
      const response = await fetch(url, { headers: { Range: "bytes=5000-6000" } })
      expect(response.status).toBe(416)
      expect(response.headers.get("content-range")).toBe("bytes */1000")
    } finally {
      await server.stop()
    }
  })

  test("a stale If-Range validator downgrades a range request to the full file", async () => {
    const { server, url } = await startWithAttachment()
    try {
      const validators = await fetch(url, { method: "HEAD" })
      const etag = validators.headers.get("etag")!

      const stale = await fetch(url, { headers: { Range: "bytes=0-9", "If-Range": 'W/"1-1"' } })
      expect(stale.status).toBe(200)
      expect((await stale.arrayBuffer()).byteLength).toBe(1000)

      const fresh = await fetch(url, { headers: { Range: "bytes=0-9", "If-Range": etag } })
      expect(fresh.status).toBe(206)
    } finally {
      await server.stop()
    }
  })

  test("HEAD advertises Accept-Ranges and a matching If-None-Match gets 304", async () => {
    const { server, url } = await startWithAttachment()
    try {
      const head = await fetch(url, { method: "HEAD" })
      expect(head.headers.get("accept-ranges")).toBe("bytes")
      expect(await head.text()).toBe("")

      const revalidated = await fetch(url, { headers: { "If-None-Match": head.headers.get("etag")! } })
      expect(revalidated.status).toBe(304)
    } finally {
      await server.stop()
    }
  })
})
