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
