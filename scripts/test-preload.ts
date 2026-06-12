// Bun test preload. Runs before any test module loads.
//
// Bun normally sets NODE_ENV=test for `bun test`, but a shell that exports
// NODE_ENV=production (a common dev quirk) overrides that. When React loads
// with NODE_ENV=production it omits the `act` test API, which breaks every
// test that imports `act` from "react". Force NODE_ENV back to "test" so
// React loads its development bundle.
export {}

if (process.env.NODE_ENV === "production") {
  process.env.NODE_ENV = "test"
}

// Register happy-dom BEFORE any test module loads, so `globalThis.document`
// exists for the whole shared Bun test process.
//
// Why this must happen here and stay registered: `@radix-ui/react-use-layout-
// effect` resolves its effect ONCE at module-eval time as
// `globalThis?.document ? React.useLayoutEffect : () => {}`. Whichever test file
// first loads that module decides the value for the ENTIRE run. Client tests
// register happy-dom via `setupHappyDom.ts`, but it uses a top-level
// `await import` whose settlement bun does NOT reliably order before the sibling
// component imports that pull in Radix — so on some runs Radix loaded while
// `document` was still undefined, the no-op stuck process-wide, `Portal` never
// mounted, and every dialog-content assertion silently failed. Purely
// order-dependent: green or red with identical code (the WorkflowsSection
// drill-in tests; CI #27399622423). The preload is the one place guaranteed to
// run before every test module, so registering here removes the race.
//
// happy-dom's `register()` swaps in its own fetch/Request/Response/Headers AND
// FormData/Blob/File. Restore the native Bun implementations afterwards: the
// 100+ server tests Bun.serve a loopback server and POST multipart bodies to it
// (src/server/uploads.test.ts, kanna-mcp-tools/webfetch.test.ts), and happy-dom's
// fetch can't reach loopback / its FormData doesn't serialize through native
// fetch. The DOM globals (document/window/HTMLElement/…) stay happy-dom's, which
// is all the client render tests need.
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

  // Reset the shared happy-dom document between every test, process-wide.
  //
  // happy-dom registers ONE global document for the whole Bun process, reused
  // across every test file. React portals (Radix Dialog/Popover/Tooltip and the
  // raw `createPortal` modals) mount into `document.body`, NOT the test's own
  // container — so a test that calls `container.remove()` but never unmounts its
  // React root leaks the portal node into `document.body`, where it survives
  // into later test files. Now that portals actually render (see above), a
  // leaked dialog poisons any later document-wide query, e.g.
  // `document.querySelector('[role="dialog"]')` in MermaidZoomModal.test.tsx
  // picking up a stale WorkflowsSection dialog. Clearing the body after each
  // test makes every test start from a clean DOM. Safe because tests append a
  // fresh container per render and none build DOM in `beforeAll`.
  const { afterEach } = require("bun:test") as typeof import("bun:test")
  afterEach(() => {
    if (typeof globalThis.document !== "undefined" && globalThis.document.body) {
      globalThis.document.body.innerHTML = ""
    }
  })
}

// Temporary diagnostic: detect leaked `node:fs` watchers (the intermittent
// CI hang is a single bun "File Watcher" thread stuck on inotify read at
// shutdown because some test created an fs.watch and never closed it). When
// KANNA_WATCH_LEAK=1, every watch() call is tracked with its creation stack
// and any watcher still open at process exit is dumped to stderr.
if (process.env.KANNA_WATCH_LEAK === "1") {
  // Synchronous require — Bun does not await top-level await in preload.
  const { mock } = require("bun:test") as typeof import("bun:test")
  const realFs = require("node:fs") as typeof import("node:fs")

  // Bun's test runner tears down hard and does not reliably run
  // 'exit'/'beforeExit' listeners, so an end-of-run dump is impossible.
  // Instead log every OPEN (id + target + creation stack) and every CLOSE
  // (id) immediately to fd 2. Post-process: an id with OPEN and no matching
  // CLOSE is a leaked watcher — its stack pinpoints the culprit test.
  const emit = (msg: string) => {
    try {
      realFs.writeSync(2, msg)
    } catch {
      /* fd 2 gone — nothing we can do */
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
