const nativeFetch = globalThis.fetch
const nativeRequest = globalThis.Request
const nativeResponse = globalThis.Response
const nativeHeaders = globalThis.Headers

const { GlobalRegistrator } = await import("@happy-dom/global-registrator")

if (!GlobalRegistrator.isRegistered) {
  GlobalRegistrator.register({ url: "http://localhost/" })
}

if (typeof nativeFetch === "function") {
  globalThis.fetch = nativeFetch
  globalThis.Request = nativeRequest
  globalThis.Response = nativeResponse
  globalThis.Headers = nativeHeaders
}

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

export {}
