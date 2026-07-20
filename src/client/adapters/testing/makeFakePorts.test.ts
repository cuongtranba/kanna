/**
 * Tests for makeFakePorts.ts — verifies that every fake port satisfies its
 * port interface and records observable side effects correctly.
 */

import { describe, expect, test } from "bun:test"
import {
  makeFakeHttpPort,
  makeFakeStoragePort,
  makeFakeTimerPort,
  makeFakeDomPort,
  makeFakeNotificationPort,
  makeFakeSoundPort,
  makeFakeClipboardPort,
  makeAllFakePorts,
} from "./makeFakePorts"

// ---------------------------------------------------------------------------
// FakeHttpPort
// ---------------------------------------------------------------------------

describe("makeFakeHttpPort", () => {
  test("getJson records call and returns registered route", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "GET", url: "/api/foo", response: { ok: true, status: 200, body: { value: 1 } } })
    const result = await http.getJson<{ value: number }>("/api/foo")
    expect(result.ok).toBe(true)
    expect(result.status).toBe(200)
    expect(result.data).toEqual({ value: 1 })
    expect(http.calls).toEqual([{ method: "GET", url: "/api/foo" }])
  })

  test("getJson throws when no route matches", async () => {
    const http = makeFakeHttpPort()
    await expect(http.getJson("/api/missing")).rejects.toThrow("No GET route registered")
  })

  test("postJson records call and returns registered route", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "POST", url: "/api/bar", response: { ok: true, status: 201, body: { id: "x" } } })
    const result = await http.postJson<{ id: string }>("/api/bar", { name: "test" })
    expect(result.ok).toBe(true)
    expect(result.data).toEqual({ id: "x" })
    expect(http.calls[0]).toEqual({ method: "POST", url: "/api/bar" })
  })

  test("head returns ok/status/headers", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({
      method: "HEAD",
      url: "/api/file.txt",
      response: { ok: true, status: 200, body: null, headers: { "content-type": "text/plain", "content-length": "42" } },
    })
    const result = await http.head("/api/file.txt")
    expect(result.ok).toBe(true)
    expect(result.headers["content-type"]).toBe("text/plain")
  })

  test("head returns 404 status for missing", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "HEAD", url: "/api/gone", response: { ok: false, status: 404, body: null } })
    const result = await http.head("/api/gone")
    expect(result.ok).toBe(false)
    expect(result.status).toBe(404)
  })

  test("del records call and returns status", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "DELETE", url: "/api/upload/1", response: { ok: true, status: 204, body: null } })
    const result = await http.del("/api/upload/1")
    expect(result.ok).toBe(true)
    expect(http.calls[0]).toEqual({ method: "DELETE", url: "/api/upload/1" })
  })

  test("streamBytes returns a readable stream", async () => {
    const http = makeFakeHttpPort()
    http.routes.push({ method: "GET", url: "/api/text", response: { ok: true, status: 200, body: { hello: "world" } } })
    const result = await http.streamBytes("/api/text")
    expect(result.ok).toBe(true)
    expect(result.body).not.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// FakeStoragePort
// ---------------------------------------------------------------------------

describe("makeFakeStoragePort", () => {
  test("get/set/remove/clear round-trip", () => {
    const storage = makeFakeStoragePort()
    expect(storage.getItem("key")).toBeNull()
    storage.setItem("key", "value")
    expect(storage.getItem("key")).toBe("value")
    storage.removeItem("key")
    expect(storage.getItem("key")).toBeNull()
  })

  test("clear removes all entries", () => {
    const storage = makeFakeStoragePort()
    storage.setItem("a", "1")
    storage.setItem("b", "2")
    storage.clear()
    expect(storage.getItem("a")).toBeNull()
    expect(storage.getItem("b")).toBeNull()
  })

  test("store map reflects state", () => {
    const storage = makeFakeStoragePort()
    storage.setItem("x", "42")
    expect(storage.store.get("x")).toBe("42")
  })
})

// ---------------------------------------------------------------------------
// FakeTimerPort
// ---------------------------------------------------------------------------

describe("makeFakeTimerPort", () => {
  test("setTimeout registers a callback", () => {
    const timer = makeFakeTimerPort()
    let called = false
    timer.setTimeout(() => { called = true }, 100)
    expect(called).toBe(false)
    timer.flushTimeouts()
    expect(called).toBe(true)
  })

  test("clearTimeout prevents the callback from firing", () => {
    const timer = makeFakeTimerPort()
    let called = false
    const id = timer.setTimeout(() => { called = true }, 100)
    timer.clearTimeout(id)
    timer.flushTimeouts()
    expect(called).toBe(false)
  })

  test("setInterval registers a callback flushed on demand", () => {
    const timer = makeFakeTimerPort()
    let count = 0
    timer.setInterval(() => { count++ }, 50)
    timer.flushIntervals()
    timer.flushIntervals()
    expect(count).toBe(2)
  })

  test("clearInterval stops the interval", () => {
    const timer = makeFakeTimerPort()
    let count = 0
    const id = timer.setInterval(() => { count++ }, 50)
    timer.clearInterval(id)
    timer.flushIntervals()
    expect(count).toBe(0)
  })

  test("requestAnimationFrame returns an id", () => {
    const timer = makeFakeTimerPort()
    const id = timer.requestAnimationFrame(() => undefined)
    expect(typeof id).toBe("number")
    timer.cancelAnimationFrame(id)
  })
})

// ---------------------------------------------------------------------------
// FakeDomPort
// ---------------------------------------------------------------------------

describe("makeFakeDomPort", () => {
  test("getTitle / setTitle round-trip", () => {
    const dom = makeFakeDomPort({ title: "Initial" })
    expect(dom.getTitle()).toBe("Initial")
    dom.setTitle("Updated")
    expect(dom.getTitle()).toBe("Updated")
  })

  test("getVisibilityState returns configured value", () => {
    const dom = makeFakeDomPort({ visibilityState: "hidden" })
    expect(dom.getVisibilityState()).toBe("hidden")
  })

  test("hasFocus reflects configuration", () => {
    const dom = makeFakeDomPort({ focused: false })
    expect(dom.hasFocus()).toBe(false)
  })

  test("reload sets reloaded flag", () => {
    const dom = makeFakeDomPort()
    expect(dom.reloaded).toBe(false)
    dom.reload()
    expect(dom.reloaded).toBe(true)
  })

  test("addWindowListener registers handler and cleanup removes it", () => {
    const dom = makeFakeDomPort()
    const cleanup = dom.addWindowListener("click", () => undefined)
    expect(dom.eventListenerCounts.get("click")).toBe(1)
    cleanup()
    expect(dom.eventListenerCounts.get("click")).toBe(0)
  })

  test("getUserAgent returns configured value", () => {
    const dom = makeFakeDomPort({ userAgent: "TestAgent/2.0" })
    expect(dom.getUserAgent()).toBe("TestAgent/2.0")
  })

  test("isSecureContext returns configured value", () => {
    const dom = makeFakeDomPort({ secure: false })
    expect(dom.isSecureContext()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FakeNotificationPort
// ---------------------------------------------------------------------------

describe("makeFakeNotificationPort", () => {
  test("returns configured permission", () => {
    const n = makeFakeNotificationPort("denied")
    expect(n.getPermission()).toBe("denied")
  })

  test("requestPermission resolves to granted", async () => {
    const n = makeFakeNotificationPort("default")
    const result = await n.requestPermission()
    expect(result).toBe("granted")
  })

  test("isSupported returns configured value", () => {
    const n = makeFakeNotificationPort("default", false)
    expect(n.isSupported()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// FakeSoundPort
// ---------------------------------------------------------------------------

describe("makeFakeSoundPort", () => {
  test("play records the src", async () => {
    const sound = makeFakeSoundPort()
    await sound.play("/chat-sounds/Funk.mp3")
    expect(sound.played).toEqual(["/chat-sounds/Funk.mp3"])
  })

  test("multiple plays accumulate", async () => {
    const sound = makeFakeSoundPort()
    await sound.play("/a.mp3")
    await sound.play("/b.mp3")
    expect(sound.played.length).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// FakeClipboardPort
// ---------------------------------------------------------------------------

describe("makeFakeClipboardPort", () => {
  test("writeText stores text and readText returns it", async () => {
    const cb = makeFakeClipboardPort()
    await cb.writeText("hello world")
    const result = await cb.readText()
    expect(result).toBe("hello world")
  })

  test("counts calls", async () => {
    const cb = makeFakeClipboardPort()
    await cb.writeText("x")
    await cb.readText()
    expect(cb.writeCalls).toBe(1)
    expect(cb.readCalls).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// makeAllFakePorts convenience helper
// ---------------------------------------------------------------------------

describe("makeAllFakePorts", () => {
  test("returns independent port instances", () => {
    const ports = makeAllFakePorts()
    expect(ports.http).toBeDefined()
    expect(ports.localStorage).toBeDefined()
    expect(ports.sessionStorage).toBeDefined()
    expect(ports.timer).toBeDefined()
    expect(ports.dom).toBeDefined()
    expect(ports.notification).toBeDefined()
    expect(ports.sound).toBeDefined()
    expect(ports.clipboard).toBeDefined()
    // Verify independence: two calls produce different instances
    const ports2 = makeAllFakePorts()
    expect(ports.localStorage).not.toBe(ports2.localStorage)
  })
})
