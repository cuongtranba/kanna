import { localStorageAdapter } from "../adapters/storage.adapter"
import { pushAdapter } from "../adapters/push.adapter"
import { notificationAdapter } from "../adapters/notification.adapter"
import type { StoragePort } from "../ports/storagePort"
import type { PushPort } from "../ports/pushPort"
import type { NotificationPort } from "../ports/notificationPort"

export type PushPermissionState =
  | "unsupported"
  | "insecure-context"
  | "default"
  | "granted"
  | "denied"

export interface PushSupportSnapshot {
  state: PushPermissionState
}

export interface PushClientPorts {
  storage?: StoragePort
  push?: PushPort
  notification?: NotificationPort
}

const PUSH_DEVICE_ID_STORAGE_KEY = "pushDeviceId"

export function getStoredPushDeviceId(ports: PushClientPorts = {}): string | null {
  const storage = ports.storage ?? localStorageAdapter
  return storage.getItem(PUSH_DEVICE_ID_STORAGE_KEY)
}

export function setStoredPushDeviceId(id: string, ports: PushClientPorts = {}): void {
  const storage = ports.storage ?? localStorageAdapter
  storage.setItem(PUSH_DEVICE_ID_STORAGE_KEY, id)
}

export function clearStoredPushDeviceId(ports: PushClientPorts = {}): void {
  const storage = ports.storage ?? localStorageAdapter
  storage.removeItem(PUSH_DEVICE_ID_STORAGE_KEY)
}

function isFeatureSupported(push: PushPort, notification: NotificationPort): boolean {
  if (!notification.isSupported()) return false
  if (!push.isServiceWorkerSupported()) return false
  if (!push.isPushManagerSupported()) return false
  return true
}

function isSecure(push: PushPort): boolean {
  if (push.isSecureContext()) return true
  const host = push.getHostname()
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

export function detectPushSupport(ports: PushClientPorts = {}): PushSupportSnapshot {
  const push = ports.push ?? pushAdapter
  const notification = ports.notification ?? notificationAdapter
  if (!isFeatureSupported(push, notification)) return { state: "unsupported" }
  if (!isSecure(push)) return { state: "insecure-context" }
  switch (notification.getPermission()) {
    case "granted": return { state: "granted" }
    case "denied": return { state: "denied" }
    default: return { state: "default" }
  }
}

export interface PushSubscribeServerCall {
  subscription: { endpoint: string; keys: { p256dh: string; auth: string } }
  label: string
  userAgent: string
}

export function urlBase64ToUint8Array(base64String: string): Uint8Array<ArrayBuffer> {
  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64String, "base64url"))
  }
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4)
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  const bytes = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i += 1) {
    bytes[i] = raw.charCodeAt(i)
  }
  return bytes
}

function deriveLabel(userAgent: string): string {
  const ua = userAgent || ""
  if (/iPhone|iPad/i.test(ua)) return "iPhone / iPad"
  if (/Android/i.test(ua)) return "Android"
  if (/Macintosh/i.test(ua)) return "Mac"
  if (/Windows/i.test(ua)) return "Windows PC"
  return ua || "Browser"
}

export async function subscribePush(args: {
  vapidPublicKey: string
  sendToServer: (payload: PushSubscribeServerCall) => Promise<{ id: string }>
} & PushClientPorts): Promise<string> {
  const push = args.push ?? pushAdapter
  const notification = args.notification ?? notificationAdapter

  const support = detectPushSupport({ push, notification })
  if (support.state === "unsupported") throw new Error("Push not supported in this browser")
  if (support.state === "insecure-context") throw new Error("Push requires a secure context (HTTPS)")
  if (support.state === "denied") throw new Error("Notification permission previously denied")

  const result = await notification.requestPermission()
  if (result !== "granted") throw new Error("Notification permission was not granted")

  const reg = await push.registerServiceWorker("/sw.js")
  await push.getReadyServiceWorkerRegistration()
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(args.vapidPublicKey),
  })

  const json = subscription.toJSON()
  const endpoint = json.endpoint ?? subscription.endpoint
  const keys: { p256dh?: string; auth?: string } = json.keys ?? {}
  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("Subscription returned without endpoint or keys")
  }
  const ua = push.getUserAgent() ?? ""
  const { id } = await args.sendToServer({
    subscription: { endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } },
    label: deriveLabel(ua),
    userAgent: ua,
  })
  return id
}

export async function unsubscribePush(args: {
  pushDeviceId: string
  sendToServer: (pushDeviceId: string) => Promise<void>
} & PushClientPorts): Promise<void> {
  const push = args.push ?? pushAdapter
  const reg = await push.getReadyServiceWorkerRegistration()
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await args.sendToServer(args.pushDeviceId)
}
