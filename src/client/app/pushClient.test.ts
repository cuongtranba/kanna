import { describe, expect, test } from "bun:test"
import {
  detectPushSupport,
  subscribePush,
  unsubscribePush,
  urlBase64ToUint8Array,
  type PushSubscribeServerCall,
} from "./pushClient"
import { makeFakePushPort } from "../adapters/testing/makeFakePushPort"
import { makeFakeNotificationPort } from "../adapters/testing/makeFakePorts"
import type { ServiceWorkerRegistrationLike } from "../ports/pushPort"

const VAPID_KEY = "BPg4MhSNQjK4FjoUf4f9Ye_K2gM4ahK_5BWj9rYjZ8sHbqJj9oKkrFHBwZJh1XJF8AaXh"

const supportedNotification = makeFakeNotificationPort("default", true)
const grantedNotification = makeFakeNotificationPort("granted", true)
const deniedNotification = makeFakeNotificationPort("denied", true)

function makeReg(overrides?: Partial<ServiceWorkerRegistrationLike["pushManager"]>): ServiceWorkerRegistrationLike {
  const sub = {
    endpoint: "https://push.example/abc",
    toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }),
    unsubscribe: async () => true,
  }
  return {
    pushManager: {
      subscribe: async () => sub,
      getSubscription: async () => null,
      ...overrides,
    },
  }
}

describe("detectPushSupport", () => {
  test("unsupported when service workers not supported", () => {
    const push = makeFakePushPort({ serviceWorkerSupported: false })
    expect(detectPushSupport({ push, notification: supportedNotification }).state).toBe("unsupported")
  })

  test("unsupported when PushManager not supported", () => {
    const push = makeFakePushPort({ pushManagerSupported: false })
    expect(detectPushSupport({ push, notification: supportedNotification }).state).toBe("unsupported")
  })

  test("insecure-context when not secure and not localhost", () => {
    const push = makeFakePushPort({ isSecureContext: false, hostname: "foo.example" })
    expect(detectPushSupport({ push, notification: supportedNotification }).state).toBe("insecure-context")
  })

  test("default when localhost over http", () => {
    const push = makeFakePushPort({ isSecureContext: false, hostname: "localhost" })
    expect(detectPushSupport({ push, notification: supportedNotification }).state).toBe("default")
  })

  test("granted when permission is granted", () => {
    const push = makeFakePushPort()
    expect(detectPushSupport({ push, notification: grantedNotification }).state).toBe("granted")
  })

  test("denied when permission is denied", () => {
    const push = makeFakePushPort()
    expect(detectPushSupport({ push, notification: deniedNotification }).state).toBe("denied")
  })
})

describe("urlBase64ToUint8Array", () => {
  test("decodes a known VAPID key", () => {
    const decoded = urlBase64ToUint8Array(VAPID_KEY)
    expect(decoded).toBeInstanceOf(Uint8Array)
    expect(decoded.length).toBeGreaterThan(40)
  })
})

describe("subscribePush", () => {
  test("requests permission, registers SW, subscribes, calls server, returns id", async () => {
    const reg = makeReg()
    const push = makeFakePushPort({ registration: reg })
    const notification = makeFakeNotificationPort("default", true)

    const calls: PushSubscribeServerCall[] = []
    const id = await subscribePush({
      vapidPublicKey: VAPID_KEY,
      push,
      notification,
      sendToServer: async (payload) => {
        calls.push(payload)
        return { id: "device-1" }
      },
    })

    expect(id).toBe("device-1")
    expect(calls).toHaveLength(1)
    expect(calls[0].subscription.endpoint).toBe("https://push.example/abc")
  })

  test("throws when permission previously denied", async () => {
    const push = makeFakePushPort()
    await expect(
      subscribePush({
        vapidPublicKey: VAPID_KEY,
        push,
        notification: deniedNotification,
        sendToServer: async () => ({ id: "x" }),
      }),
    ).rejects.toThrow(/permission/i)
  })
})

describe("unsubscribePush", () => {
  test("calls subscription.unsubscribe and notifies server", async () => {
    let unsubscribed = false
    const sub = {
      endpoint: "https://push.example/abc",
      toJSON: () => ({ endpoint: "https://push.example/abc", keys: { p256dh: "p", auth: "a" } }),
      unsubscribe: async () => { unsubscribed = true; return true },
    }
    const reg = makeReg({ getSubscription: async () => sub })
    const push = makeFakePushPort({ registration: reg })

    let told: string | null = null
    await unsubscribePush({
      pushDeviceId: "device-1",
      push,
      sendToServer: async (id) => { told = id },
    })

    expect(unsubscribed).toBe(true)
    expect(told!).toBe("device-1")
  })
})
