export {}

if (process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test"
}

{
  const nativeFetch = globalThis.fetch
  const nativeRequest = globalThis.Request
  const nativeResponse = globalThis.Response
  const nativeHeaders = globalThis.Headers
  const nativeFormData = globalThis.FormData
  const nativeBlob = globalThis.Blob
  const nativeFile = globalThis.File

  const { GlobalRegistrator } =
    require("@happy-dom/global-registrator") as typeof import("@happy-dom/global-registrator")
  if (!GlobalRegistrator.isRegistered) {
    GlobalRegistrator.register({ url: "http://localhost/" })
  }

  if (typeof nativeFetch === "function") {
    globalThis.fetch = nativeFetch
    globalThis.Request = nativeRequest
    globalThis.Response = nativeResponse
    globalThis.Headers = nativeHeaders
    globalThis.FormData = nativeFormData
    globalThis.Blob = nativeBlob
    globalThis.File = nativeFile
  }

  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

  const isReactOwned = (element: Element): boolean =>
    Object.keys(element).some((key) => key.startsWith("__reactFiber$") || key.startsWith("__reactContainer$"))

  const teardowns = new Set<() => void>()
  ;(globalThis as { __kannaDomTeardowns?: Set<() => void> }).__kannaDomTeardowns = teardowns

  const { afterEach } = require("bun:test") as typeof import("bun:test")
  afterEach(() => {
    for (const teardown of teardowns) teardown()
    teardowns.clear()
    if (typeof globalThis.document === "undefined" || !globalThis.document.body) return
    const leaked = [...globalThis.document.body.children]
      .filter(isReactOwned)
      .map((element) => element.tagName.toLowerCase() + (element.id ? `#${element.id}` : ""))
    globalThis.document.body.innerHTML = ""
    if (leaked.length > 0) {
      throw new Error(
        `Test left ${String(leaked.length)} React-owned node(s) in document.body: ${leaked.join(", ")}. ` +
          "Unmount the root (`root.unmount()`), not just `container.remove()` — a live root whose " +
          "nodes were swept commits into a DOM that no longer holds them, and happy-dom throws " +
          "`removeChild` from inside an unrelated test in a later file.",
      )
    }
  })
}

if (process.env.KANNA_WATCH_LEAK === "1") {
  const { mock } = require("bun:test") as typeof import("bun:test")
  const realFs = require("node:fs") as typeof import("node:fs")

  const emit = (msg: string) => {
    try {
      realFs.writeSync(2, msg)
    } catch {
    }
  }

  let seq = 0
  function wrapWatch(realWatch: typeof realFs.watch) {
    return function watch(this: unknown, ...args: unknown[]) {
      const w = (realWatch as (...a: unknown[]) => { close: () => void }).apply(this, args)
      const id = ++seq
      const target = typeof args[0] === "string" ? args[0] : String(args[0])
      const stack = (new Error().stack ?? "(no stack)").split("\n").slice(1).join("\n")
      emit(`[watch-leak] OPEN ${id} target=${target}\n${stack}\n[watch-leak] /OPEN ${id}\n`)
      let closedOnce = false
      const realClose = w.close.bind(w)
      w.close = function close() {
        if (!closedOnce) {
          closedOnce = true
          emit(`[watch-leak] CLOSE ${id}\n`)
        }
        return realClose()
      }
      return w
    }
  }

  const wrappedWatch = wrapWatch(realFs.watch)
  const patched = { ...realFs, watch: wrappedWatch }
  mock.module("node:fs", () => ({ ...patched, default: patched }))
  emit("[watch-leak] detector armed\n")
}
