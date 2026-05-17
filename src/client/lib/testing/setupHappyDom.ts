// Capture native Bun-side fetch BEFORE importing @happy-dom/global-registrator,
// since happy-dom's import side-effects can monkey-patch fetch on globalThis
// just by being evaluated. Subsequent server-side tests in the same Bun
// process (notably src/server/kanna-mcp-tools/webfetch.test.ts, which Bun.serve's
// a local server and fetches it) rely on the native loopback-capable fetch.
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
