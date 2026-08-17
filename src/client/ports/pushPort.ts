import type { ServiceWorkerRegistrationLike } from "./domPort"

export type { ServiceWorkerRegistrationLike }

export interface PushPort {
  isServiceWorkerSupported(): boolean
  isPushManagerSupported(): boolean
  isSecureContext(): boolean
  getHostname(): string
  getUserAgent(): string
  registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike>
  getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike>
}
