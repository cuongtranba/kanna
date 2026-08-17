import type { PushPort, ServiceWorkerRegistrationLike } from "../../ports/pushPort"

const defaultRegistration: ServiceWorkerRegistrationLike = {
  pushManager: {
    async subscribe() {
      return {
        endpoint: "https://push.example/fake",
        toJSON: () => ({ endpoint: "https://push.example/fake", keys: { p256dh: "p", auth: "a" } }),
        async unsubscribe() { return true },
      }
    },
    async getSubscription() { return null },
  },
}

export interface FakePushPortOptions {
  serviceWorkerSupported?: boolean
  pushManagerSupported?: boolean
  isSecureContext?: boolean
  hostname?: string
  userAgent?: string
  registration?: ServiceWorkerRegistrationLike
}

export function makeFakePushPort(options: FakePushPortOptions = {}): PushPort {
  const {
    serviceWorkerSupported = true,
    pushManagerSupported = true,
    isSecureContext: secureContext = true,
    hostname = "localhost",
    userAgent = "FakeBrowser/1.0",
    registration = defaultRegistration,
  } = options

  return {
    isServiceWorkerSupported: () => serviceWorkerSupported,
    isPushManagerSupported: () => pushManagerSupported,
    isSecureContext: () => secureContext,
    getHostname: () => hostname,
    getUserAgent: () => userAgent,
    registerServiceWorker: async () => registration,
    getReadyServiceWorkerRegistration: async () => registration,
  }
}
