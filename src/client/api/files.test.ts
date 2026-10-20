
import { describe, expect, test } from "bun:test"
import { probeFileUrl, deleteUploadedFile, fetchFileTextPreview } from "./files"
import { makeFakeCommandPort, makeFakeHttpPort } from "../adapters/testing/makeFakePorts"

describe("probeFileUrl", () => {
  test("returns ready with mimeType and size on 200", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "HEAD",
      url: "/api/uploads/file.txt",
      response: {
        ok: true,
        status: 200,
        body: null,
        headers: { "content-type": "text/plain", "content-length": "1024" },
      },
    })
    const result = await probeFileUrl("/api/uploads/file.txt", { http })
    expect(result.kind).toBe("ready")
    if (result.kind === "ready") {
      expect(result.mimeType).toBe("text/plain")
      expect(result.size).toBe(1024)
    }
  })

  test("returns missing on 404", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "HEAD",
      url: "/api/uploads/gone.txt",
      response: { ok: false, status: 404, body: null },
    })
    const result = await probeFileUrl("/api/uploads/gone.txt", { http })
    expect(result.kind).toBe("missing")
  })

  test("returns error on 5xx", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "HEAD",
      url: "/api/uploads/err.txt",
      response: { ok: false, status: 503, body: null },
    })
    const result = await probeFileUrl("/api/uploads/err.txt", { http })
    expect(result.kind).toBe("error")
  })

  test("returns error on network throw", async () => {
    const http = makeFakeHttpPort()
    const result = await probeFileUrl("/api/uploads/no-route", { http })
    expect(result.kind).toBe("error")
  })

  test("defaults mimeType when content-type header absent", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "HEAD",
      url: "/api/uploads/binary",
      response: { ok: true, status: 200, body: null, headers: {} },
    })
    const result = await probeFileUrl("/api/uploads/binary", { http })
    expect(result.kind).toBe("ready")
    if (result.kind === "ready") {
      expect(result.mimeType).toBe("application/octet-stream")
    }
  })
})

describe("deleteUploadedFile", () => {
  test("asks the server to delete the upload the content URL points at", async () => {
    const commands = makeFakeCommandPort(() => ({ deleted: true }))

    await deleteUploadedFile("/api/projects/p%201/uploads/my%20file.txt/content", commands)

    expect(commands.calls).toEqual([{ type: "upload.delete", projectId: "p 1", storedName: "my file.txt" }])
  })

  test("surfaces a failed delete to the caller", async () => {
    const commands = makeFakeCommandPort(() => {
      throw new Error("Project not found")
    })

    await expect(deleteUploadedFile("/api/projects/p1/uploads/a.txt/content", commands)).rejects.toThrow("Project not found")
  })

  test("refuses a URL that is not an upload content URL instead of guessing a target", async () => {
    const commands = makeFakeCommandPort(() => ({ deleted: true }))

    await expect(deleteUploadedFile("/api/projects/p1/files/a.txt/content", commands)).rejects.toThrow("Not an upload content URL")
    expect(commands.calls).toEqual([])
  })

  test("reports a missing connection rather than dropping the delete silently", async () => {
    await expect(deleteUploadedFile("/api/projects/p1/uploads/a.txt/content", null)).rejects.toThrow("Not connected")
  })
})

describe("fetchFileTextPreview", () => {
  test("reads stream content and returns it", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/api/uploads/readme.md",
      response: { ok: true, status: 200, body: { hello: "world" } },
    })
    const result = await fetchFileTextPreview("/api/uploads/readme.md", 1024 * 1024, { http })
    expect(typeof result.content).toBe("string")
    expect(result.truncated).toBe(false)
  })

  test("throws on non-ok response", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "GET",
      url: "/api/uploads/forbidden",
      response: { ok: false, status: 403, body: null },
    })
    await expect(fetchFileTextPreview("/api/uploads/forbidden", 1024, { http })).rejects.toThrow(
      "Preview request failed with status 403",
    )
  })

  test("truncates content at limitBytes", async () => {
    const http = makeFakeHttpPort()
    const bigBody = { data: "x".repeat(100) }
    http.routes.push({
      method: "GET",
      url: "/api/uploads/large",
      response: { ok: true, status: 200, body: bigBody },
    })
    const result = await fetchFileTextPreview("/api/uploads/large", 10, { http })
    expect(result.content.length).toBeLessThanOrEqual(10)
    expect(result.truncated).toBe(true)
  })
})
