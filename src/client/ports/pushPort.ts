export interface PushSubscriptionLike {
  endpoint: string
  options?: { applicationServerKey?: ArrayBuffer | null }
  toJSON(): { endpoint?: string; keys?: { p256dh?: string; auth?: string } }
  unsubscribe(): Promise<boolean>
}

export interface ServiceWorkerRegistrationLike {
  pushManager: {
    subscribe(options: {
      userVisibleOnly: boolean
      applicationServerKey: Uint8Array<ArrayBuffer>
    }): Promise<PushSubscriptionLike>
    getSubscription(): Promise<PushSubscriptionLike | null>
  }
}

export interface PushPort {
  isServiceWorkerSupported(): boolean
  isPushManagerSupported(): boolean
  isSecureContext(): boolean
  getHostname(): string
  getUserAgent(): string
  registerServiceWorker(url: string): Promise<ServiceWorkerRegistrationLike>
  getReadyServiceWorkerRegistration(): Promise<ServiceWorkerRegistrationLike>
}
