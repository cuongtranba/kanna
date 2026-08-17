import type { PushPort, ServiceWorkerRegistrationLike } from "../ports/pushPort"

export const pushAdapter: PushPort = {
  isServiceWorkerSupported(): boolean {
    return typeof navigator !== "undefined" && "serviceWorker" in navigator
  },

  isPushManagerSupported(): boolean {
    return typeof Reflect.get(globalThis, "PushManager") !== "undefined"
  },

  isSecureContext(): boolean {
    return window.isSecureContext
  },

  getHostname(): string {
    return window.location?.hostname ?? ""
  },

  getUserAgent(): string {
    return navigator.userAgent
  },

  async registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike> {
    return navigator.serviceWorker.register(url)
  },

  async getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike> {
    return navigator.serviceWorker.ready
  },
}
