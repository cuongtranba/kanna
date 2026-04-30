export type PushPermissionState =
  | "unsupported"
  | "insecure-context"
  | "default"
  | "granted"
  | "denied"

export interface PushSupportSnapshot {
  state: PushPermissionState
}

function isFeatureSupported(): boolean {
  if (typeof window === "undefined") return false
  if (typeof Notification === "undefined") return false
  if (!("serviceWorker" in navigator)) return false
  if (typeof (globalThis as { PushManager?: unknown }).PushManager === "undefined") return false
  return true
}

function isSecure(): boolean {
  if (typeof window === "undefined") return false
  if ((window as { isSecureContext?: boolean }).isSecureContext) return true
  const host = window.location?.hostname ?? ""
  return host === "localhost" || host === "127.0.0.1" || host === "::1"
}

export function detectPushSupport(): PushSupportSnapshot {
  if (!isFeatureSupported()) return { state: "unsupported" }
  if (!isSecure()) return { state: "insecure-context" }
  switch (Notification.permission) {
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

export function urlBase64ToUint8Array(base64String: string): Uint8Array {
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
}): Promise<string> {
  const support = detectPushSupport()
  if (support.state === "unsupported") throw new Error("Push not supported in this browser")
  if (support.state === "insecure-context") throw new Error("Push requires a secure context (HTTPS)")
  if (support.state === "denied") throw new Error("Notification permission previously denied")

  const result = await Notification.requestPermission()
  if (result !== "granted") throw new Error("Notification permission was not granted")

  const reg = await navigator.serviceWorker.register("/sw.js")
  await navigator.serviceWorker.ready
  const subscription = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(args.vapidPublicKey),
  })

  const json = subscription.toJSON()
  const endpoint = json.endpoint ?? subscription.endpoint
  const keys = (json.keys ?? {}) as { p256dh?: string; auth?: string }
  if (!endpoint || !keys.p256dh || !keys.auth) {
    throw new Error("Subscription returned without endpoint or keys")
  }
  const ua = navigator.userAgent ?? ""
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
}): Promise<void> {
  const reg = await navigator.serviceWorker.ready
  const sub = await reg.pushManager.getSubscription()
  if (sub) await sub.unsubscribe()
  await args.sendToServer(args.pushDeviceId)
}
