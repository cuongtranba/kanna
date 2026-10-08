import { describe, expect, test } from "bun:test"
import type { PreviousUpload, UploadOptions } from "tus-js-client"
import { UploadAbortedError, uploadFile, type LoadTus, type TusUploadLike } from "./uploadFile.adapter"

const CHUNK_SIZE_BYTES = 8 * 1024 * 1024

function createFakeTus(previousUploads: PreviousUpload[] = []) {
  let markStarted: (upload: FakeUpload) => void = () => {}
  const started = new Promise<FakeUpload>((resolve) => {
    markStarted = resolve
  })

  class FakeUpload implements TusUploadLike {
    resumedFrom: PreviousUpload | null = null
    resumedFromAtStart: PreviousUpload | null = null
    terminated: boolean | undefined
    constructor(readonly file: File, readonly options: UploadOptions) {}

    findPreviousUploads() {
      return Promise.resolve(previousUploads)
    }

    resumeFromPreviousUpload(previous: PreviousUpload) {
      this.resumedFrom = previous
    }

    start() {
      this.resumedFromAtStart = this.resumedFrom
      markStarted(this)
    }

    abort(shouldTerminate?: boolean) {
      this.terminated = shouldTerminate
      return Promise.resolve()
    }

    progress(loaded: number, total: number) {
      this.options.onProgress?.(loaded, total)
    }

    succeed(body: string) {
      this.options.onSuccess?.({
        lastResponse: {
          getStatus: () => 200,
          getHeader: () => undefined,
          getBody: () => body,
          getUnderlyingObject: () => ({}),
        },
      })
    }

    fail(responseBody: string | null) {
      const error = Object.assign(new Error("tus: unexpected response while creating upload"), {
        originalResponse: responseBody === null ? null : { getBody: () => responseBody },
      })
      this.options.onError?.(error)
    }
  }

  const loadTus: LoadTus = () => Promise.resolve({ Upload: FakeUpload })
  return { loadTus, started }
}

function createTestFile(size: number, name = "test.bin") {
  return new File([new Uint8Array(size)], name, { type: "application/octet-stream" })
}

const PREVIOUS_UPLOAD: PreviousUpload = {
  size: 1000,
  metadata: { filename: "test.bin" },
  creationTime: "2026-10-08T00:00:00.000Z",
  urlStorageKey: "tus::fingerprint::1",
  uploadUrl: "/api/projects/proj-1/uploads/tus/abc",
  parallelUploadUrls: null,
}

async function rejectionOf(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise
  } catch (error) {
    if (error instanceof Error) return error
  }
  throw new Error("expected the upload to reject")
}

describe("uploadFile", () => {
  test("uploads in 8 MiB chunks to the project's tus endpoint and resolves with the finish body's attachments", async () => {
    const tus = createFakeTus()
    const events: Array<{ loaded: number; total: number }> = []

    const handle = uploadFile({
      projectId: "proj-1",
      file: createTestFile(1000, "hello.txt"),
      onProgress: (event) => events.push(event),
      loadTus: tus.loadTus,
    })

    const upload = await tus.started
    expect(upload.options.endpoint).toBe("/api/projects/proj-1/uploads/tus")
    expect(upload.options.chunkSize).toBe(CHUNK_SIZE_BYTES)
    expect(upload.options.metadata).toEqual({ filename: "hello.txt", filetype: "application/octet-stream" })

    upload.progress(0, 1000)
    upload.progress(500, 1000)
    upload.succeed(JSON.stringify({ attachments: [{ id: "a1", displayName: "hello.txt", reused: true }] }))

    const result = await handle.promise
    expect(result.attachments[0]).toMatchObject({ id: "a1", reused: true })
    expect(events[events.length - 1]).toEqual({ loaded: 1000, total: 1000 })
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  test("resumes a previous upload of the same file instead of starting over", async () => {
    const tus = createFakeTus([PREVIOUS_UPLOAD])

    const handle = uploadFile({ projectId: "proj-1", file: createTestFile(1000), onProgress: () => {}, loadTus: tus.loadTus })

    const upload = await tus.started
    expect(upload.resumedFromAtStart).toBe(PREVIOUS_UPLOAD)
    upload.succeed(JSON.stringify({ attachments: [{ id: "a1" }] }))
    await handle.promise
  })

  test("rejects with the server's JSON error message", async () => {
    const tus = createFakeTus()
    const handle = uploadFile({ projectId: "p", file: createTestFile(10), onProgress: () => {}, loadTus: tus.loadTus })

    const upload = await tus.started
    upload.fail(JSON.stringify({ error: "File exceeds the 1 MB limit." }))

    expect((await rejectionOf(handle.promise)).message).toBe("File exceeds the 1 MB limit.")
  })

  test("rejects with a generic message when the failure carries no server error body", async () => {
    const tus = createFakeTus()
    const handle = uploadFile({ projectId: "p", file: createTestFile(10), onProgress: () => {}, loadTus: tus.loadTus })

    const upload = await tus.started
    upload.fail("<html>Cloudflare 413</html>")

    expect((await rejectionOf(handle.promise)).message).toBe("Upload failed")
  })

  test("rejects when the finish response is malformed", async () => {
    const tus = createFakeTus()
    const handle = uploadFile({ projectId: "p", file: createTestFile(10), onProgress: () => {}, loadTus: tus.loadTus })

    const upload = await tus.started
    upload.succeed(JSON.stringify({ attachments: "not-an-array" }))

    expect((await rejectionOf(handle.promise)).message).toBe("Upload failed: malformed response")
  })

  test("abort terminates the partial upload on the server and rejects with UploadAbortedError", async () => {
    const tus = createFakeTus()
    const handle = uploadFile({ projectId: "p", file: createTestFile(10), onProgress: () => {}, loadTus: tus.loadTus })

    const upload = await tus.started
    handle.abort()

    expect(await rejectionOf(handle.promise)).toBeInstanceOf(UploadAbortedError)
    expect(upload.terminated).toBe(true)
  })

  test("abort before the upload library has loaded still rejects with UploadAbortedError", async () => {
    const tus = createFakeTus()
    const handle = uploadFile({ projectId: "p", file: createTestFile(10), onProgress: () => {}, loadTus: tus.loadTus })

    handle.abort()

    expect(await rejectionOf(handle.promise)).toBeInstanceOf(UploadAbortedError)
  })
})
