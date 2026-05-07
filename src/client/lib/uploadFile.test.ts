import { describe, expect, test } from "bun:test"
import { UploadAbortedError, uploadFile } from "./uploadFile"

interface MockListener {
  type: string
  listener: (event: ProgressEvent | Event) => void
}

class MockXMLHttpRequest {
  static instances: MockXMLHttpRequest[] = []

  status = 0
  responseText = ""
  upload = { listeners: [] as MockListener[], addEventListener: (type: string, listener: (event: Event) => void) => {
    this.upload.listeners.push({ type, listener })
  } }
  private listeners: MockListener[] = []
  private aborted = false
  openedUrl = ""
  openedMethod = ""
  sentBody: BodyInit | null = null

  constructor() {
    MockXMLHttpRequest.instances.push(this)
  }

  addEventListener(type: string, listener: (event: Event) => void) {
    this.listeners.push({ type, listener })
  }

  open(method: string, url: string) {
    this.openedMethod = method
    this.openedUrl = url
  }

  send(body: BodyInit | null) {
    this.sentBody = body
  }

  abort() {
    this.aborted = true
    this.dispatch("abort")
  }

  emitProgress(loaded: number, total: number) {
    const event = { loaded, total, lengthComputable: true } as ProgressEvent
    for (const entry of this.upload.listeners) {
      if (entry.type === "progress") entry.listener(event)
    }
  }

  finishUploadStream() {
    for (const entry of this.upload.listeners) {
      if (entry.type === "load") entry.listener({} as Event)
    }
  }

  finish(status: number, body: unknown) {
    this.status = status
    this.responseText = body == null ? "" : JSON.stringify(body)
    this.dispatch("load")
  }

  fail() {
    this.dispatch("error")
  }

  private dispatch(type: string) {
    if (this.aborted && type === "load") return
    for (const entry of this.listeners) {
      if (entry.type === type) entry.listener({} as Event)
    }
  }
}

function createMockXHR() {
  MockXMLHttpRequest.instances = []
  return MockXMLHttpRequest as unknown as typeof XMLHttpRequest
}

function createTestFile(size: number, name = "test.bin") {
  return new File([new Uint8Array(size)], name, { type: "application/octet-stream" })
}

describe("uploadFile", () => {
  test("emits progress and resolves with attachments on 2xx", async () => {
    const XHR = createMockXHR()
    const events: Array<{ loaded: number; total: number }> = []

    const handle = uploadFile({
      projectId: "proj-1",
      file: createTestFile(1000, "hello.txt"),
      onProgress: (event) => events.push(event),
      XHR,
    })

    const xhr = MockXMLHttpRequest.instances[0]!
    expect(xhr.openedMethod).toBe("POST")
    expect(xhr.openedUrl).toBe("/api/projects/proj-1/uploads")

    xhr.emitProgress(0, 1000)
    xhr.emitProgress(500, 1000)
    xhr.finishUploadStream()
    xhr.finish(200, { attachments: [{ id: "a1", displayName: "hello.txt" }] })

    const result = await handle.promise
    expect(result.attachments[0]?.id).toBe("a1")
    expect(events[events.length - 1]).toEqual({ loaded: 1000, total: 1000 })
    expect(events.length).toBeGreaterThanOrEqual(2)
  })

  test("rejects with server error message on non-2xx", async () => {
    const XHR = createMockXHR()
    const handle = uploadFile({
      projectId: "p",
      file: createTestFile(10),
      onProgress: () => {},
      XHR,
    })

    const xhr = MockXMLHttpRequest.instances[0]!
    xhr.finish(413, { error: "File \"big.bin\" exceeds the 1 MB limit." })

    let thrown: unknown
    try { await handle.promise } catch (error) { thrown = error }
    expect((thrown as Error)?.message).toBe("File \"big.bin\" exceeds the 1 MB limit.")
  })

  test("rejects with UploadAbortedError when handle.abort() called", async () => {
    const XHR = createMockXHR()
    const handle = uploadFile({
      projectId: "p",
      file: createTestFile(10),
      onProgress: () => {},
      XHR,
    })

    handle.abort()

    let thrown: unknown
    try { await handle.promise } catch (error) { thrown = error }
    expect(thrown).toBeInstanceOf(UploadAbortedError)
  })

  test("rejects with generic error on network failure", async () => {
    const XHR = createMockXHR()
    const handle = uploadFile({
      projectId: "p",
      file: createTestFile(10),
      onProgress: () => {},
      XHR,
    })

    MockXMLHttpRequest.instances[0]!.fail()

    let thrown: unknown
    try { await handle.promise } catch (error) { thrown = error }
    expect((thrown as Error)?.message).toBe("Upload failed")
  })

  test("rejects when 2xx response is malformed", async () => {
    const XHR = createMockXHR()
    const handle = uploadFile({
      projectId: "p",
      file: createTestFile(10),
      onProgress: () => {},
      XHR,
    })

    MockXMLHttpRequest.instances[0]!.finish(200, { attachments: "not-an-array" })

    let thrown: unknown
    try { await handle.promise } catch (error) { thrown = error }
    expect((thrown as Error)?.message).toBe("Upload failed: malformed response")
  })
})
