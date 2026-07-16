/**
 * Tests for api/files.ts — verifies probeFileUrl, deleteUploadedFile,
 * and fetchFileTextPreview.
 */

import { describe, expect, test } from "bun:test"
import { probeFileUrl, deleteUploadedFile, fetchFileTextPreview } from "./files"
import { makeFakeHttpPort } from "../adapters/testing/makeFakePorts"

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
    // No route registered — throws inside makeFakeHttpPort
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
  test("strips /content suffix and calls DELETE", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "DELETE",
      url: "/api/uploads/1",
      response: { ok: true, status: 204, body: null },
    })
    await deleteUploadedFile("/api/uploads/1/content", { http })
    expect(http.calls[0]).toEqual({ method: "DELETE", url: "/api/uploads/1" })
  })

  test("swallows errors silently", async () => {
    const http = makeFakeHttpPort()
    // No route — DELETE will throw; should not propagate
    await expect(deleteUploadedFile("/api/uploads/missing/content", { http })).resolves.toBeUndefined()
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
    // Fake an error: provide a route with ok:false
    http.routes.push({
      method: "GET",
      url: "/api/uploads/forbidden",
      response: { ok: false, status: 403, body: null },
    })
    // streamBytes returns ok:false → function should throw
    await expect(fetchFileTextPreview("/api/uploads/forbidden", 1024, { http })).rejects.toThrow(
      "Preview request failed with status 403",
    )
  })

  test("truncates content at limitBytes", async () => {
    const http = makeFakeHttpPort()
    // Body that is larger than limit when stringified
    const bigBody = { data: "x".repeat(100) }
    http.routes.push({
      method: "GET",
      url: "/api/uploads/large",
      response: { ok: true, status: 200, body: bigBody },
    })
    // 10 byte limit — should truncate
    const result = await fetchFileTextPreview("/api/uploads/large", 10, { http })
    expect(result.content.length).toBeLessThanOrEqual(10)
    expect(result.truncated).toBe(true)
  })
})
