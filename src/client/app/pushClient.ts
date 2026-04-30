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
