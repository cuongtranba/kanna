import { afterEach, describe, expect, test } from "bun:test"
import { detectPushSupport, subscribePush, unsubscribePush, urlBase64ToUint8Array, type PushSubscribeServerCall } from "./pushClient"

// Some host environments (jsdom/happy-dom triggered by other test files in the
// same process) define `globalThis.window` as a non-writable accessor, which
// makes plain `=` assignment throw "Attempted to assign to readonly property".
// Use a configurable data property so we can freely reassign in tests.
function setGlobal(key: string, value: unknown): void {
  Object.defineProperty(globalThis, key, {
    value,
    writable: true,
    configurable: true,
    enumerable: true,
  })
}

const originalNotification = (globalThis as { Notification?: unknown }).Notification
const originalNavigator = globalThis.navigator
const originalIsSecureContext = (globalThis as { isSecureContext?: boolean }).isSecureContext
const originalWindow = (globalThis as { window?: unknown }).window
const originalPushManager = (globalThis as { PushManager?: unknown }).PushManager

afterEach(() => {
  setGlobal("Notification", originalNotification)
  setGlobal("navigator", originalNavigator)
  setGlobal("isSecureContext", originalIsSecureContext)
  setGlobal("window", originalWindow)
  setGlobal("PushManager", originalPushManager)
})

function setupBrowser(opts: {
  hasNotification?: boolean
  hasServiceWorker?: boolean
  hasPushManager?: boolean
  isSecureContext?: boolean
  hostname?: string
  permission?: NotificationPermission
}) {
  setGlobal("window", {
    isSecureContext: opts.isSecureContext ?? true,
    location: { hostname: opts.hostname ?? "example.com" },
  })
  setGlobal("isSecureContext", opts.isSecureContext ?? true)
  setGlobal(
    "Notification",
    opts.hasNotification === false
      ? undefined
      : { permission: opts.permission ?? "default", requestPermission: async () => "granted" },
  )
  setGlobal(
    "navigator",
    opts.hasServiceWorker === false
      ? {}
      : { serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) }, userAgent: "test" },
  )
  setGlobal("PushManager", opts.hasPushManager === false ? undefined : function () {})
}

describe("detectPushSupport", () => {
  test("unsupported when Notification API missing", () => {
    setupBrowser({ hasNotification: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("unsupported when serviceWorker missing", () => {
    setupBrowser({ hasServiceWorker: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("unsupported when PushManager missing", () => {
    setupBrowser({ hasPushManager: false })
    expect(detectPushSupport().state).toBe("unsupported")
  })

  test("insecure-context when not isSecureContext and not localhost", () => {
    setupBrowser({ isSecureContext: false, hostname: "foo.example" })
    expect(detectPushSupport().state).toBe("insecure-context")
  })

  test("default when localhost over http", () => {
    setupBrowser({ isSecureContext: false, hostname: "localhost", permission: "default" })
    expect(detectPushSupport().state).toBe("default")
  })

  test("granted when permission is granted", () => {
    setupBrowser({ permission: "granted" })
    expect(detectPushSupport().state).toBe("granted")
  })

  test("denied when permission is denied", () => {
    setupBrowser({ permission: "denied" })
    expect(detectPushSupport().state).toBe("denied")
  })
})

describe("urlBase64ToUint8Array", () => {
  test("decodes a known VAPID key", () => {
    const key = "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh"
    const decoded = urlBase64ToUint8Array(key)
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(decoded.length).toBeGreaterThan(40)
  })
})

describe("subscribePush", () => {
  test("requests permission, registers SW, subscribes, calls server, returns id", async () => {
    const subscribe = async (_opts: { applicationServerKey: Uint8Array; userVisibleOnly: boolean }) => ({
      endpoint: "https://push.example/abc",
      toJSON: () => ({
        endpoint: "https://push.example/abc",
        keys: { p256dh: "p", auth: "a" },
      }),
    })
    const reg = { pushManager: { subscribe, getSubscription: async () => null } }
    setGlobal("window", { isSecureContext: true, location: { hostname: "x" } })
    setGlobal("Notification", {
      permission: "default",
      requestPermission: async () => "granted",
    })
    setGlobal("navigator", {
      serviceWorker: {
        register: async () => reg,
        ready: Promise.resolve(reg),
      },
      userAgent: "Mozilla/5.0 (TestUA)",
    })
    setGlobal("PushManager", function () {})

    const calls: PushSubscribeServerCall[] = []
    const id = await subscribePush({
      vapidPublicKey: "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh",
      sendToServer: async (payload) => {
        calls.push(payload)
        return { id: "device-1" }
      },
    })

    expect(id).toBe("device-1")
    expect(calls).toHaveLength(1)
    expect(calls[0].subscription.endpoint).toBe("https://push.example/abc")
    expect(calls[0].label).toMatch(/Mozilla/)
  })

  test("throws when permission denied", async () => {
    setGlobal("window", { isSecureContext: true, location: { hostname: "x" } })
    setGlobal("Notification", {
      permission: "default",
      requestPermission: async () => "denied",
    })
    setGlobal("navigator", {
      serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) },
      userAgent: "ua",
    })
    setGlobal("PushManager", function () {})

    await expect(subscribePush({
      vapidPublicKey: "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh",
      sendToServer: async () => ({ id: "x" }),
    })).rejects.toThrow(/permission/i)
  })
})

describe("unsubscribePush", () => {
  test("calls subscription.unsubscribe and notifies server", async () => {
    let unsubscribed = false
    const sub = { unsubscribe: async () => { unsubscribed = true; return true } }
    const reg = { pushManager: { getSubscription: async () => sub } }
    setGlobal("navigator", {
      serviceWorker: { ready: Promise.resolve(reg), register: async () => reg },
      userAgent: "ua",
    })

    let told: string | null = null
    await unsubscribePush({
      pushDeviceId: "device-1",
      sendToServer: async (id) => { told = id },
    })
    expect(unsubscribed).toBe(true)
    expect(told!).toBe("device-1")
  })
})
