import { afterEach, describe, expect, test } from "bun:test"
import { detectPushSupport } from "./pushClient"

const originalNotification = (globalThis as { Notification?: unknown }).Notification
const originalNavigator = globalThis.navigator
const originalIsSecureContext = (globalThis as { isSecureContext?: boolean }).isSecureContext
const originalWindow = (globalThis as { window?: unknown }).window
const originalPushManager = (globalThis as { PushManager?: unknown }).PushManager

afterEach(() => {
  ;(globalThis as { Notification?: unknown }).Notification = originalNotification
  ;(globalThis as { navigator?: unknown }).navigator = originalNavigator
  ;(globalThis as { isSecureContext?: boolean }).isSecureContext = originalIsSecureContext
  ;(globalThis as { window?: unknown }).window = originalWindow
  ;(globalThis as { PushManager?: unknown }).PushManager = originalPushManager
})

function setupBrowser(opts: {
  hasNotification?: boolean
  hasServiceWorker?: boolean
  hasPushManager?: boolean
  isSecureContext?: boolean
  hostname?: string
  permission?: NotificationPermission
}) {
  ;(globalThis as { window?: unknown }).window = {
    isSecureContext: opts.isSecureContext ?? true,
    location: { hostname: opts.hostname ?? "example.com" },
  }
  ;(globalThis as { isSecureContext?: boolean }).isSecureContext = opts.isSecureContext ?? true
  ;(globalThis as { Notification?: unknown }).Notification = opts.hasNotification === false
    ? undefined
    : { permission: opts.permission ?? "default", requestPermission: async () => "granted" }
  ;(globalThis as { navigator?: unknown }).navigator = opts.hasServiceWorker === false
    ? {}
    : { serviceWorker: { register: async () => ({}), ready: Promise.resolve({}) }, userAgent: "test" }
  ;(globalThis as { PushManager?: unknown }).PushManager = opts.hasPushManager === false ? undefined : function () {}
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
