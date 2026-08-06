import { afterEach, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { extname, join } from "node:path"
import { buildLoopProgress } from "../shared/loop-progress"
import { markdownDoc } from "../shared/structured-doc/markdown"
import { resolveStructuredDoc } from "../shared/structured-doc/registry"
import type { AutoContinueEvent } from "./auto-continue/events"
import { readTrackingFile, watchTrackingFile } from "./loop-tracking-io.adapter"
import { createLoopTrackingRegistry } from "./loop-tracking-registry"
import { syncLoopTracking } from "./loop-tracking-sync"

const DOC = [
  "# Loop tracking file",
  "",
  "## Progress (latest first)",
  "- 2026-08-06 chunk two DONE",
  "- 2026-08-05 chunk one DONE",
  "",
  "## Next chunk",
  "chunk three",
  "",
].join("\n")

interface Harness {
  registry: ReturnType<typeof createLoopTrackingRegistry>
  watched: string[]
  disposed: string[]
  reads: string[]
  contentByPath: Map<string, string | null>
  touch: (path: string) => void
}

function harness(overrides: { maxDoneEntries?: number } = {}): Harness {
  const watched: string[] = []
  const disposed: string[] = []
  const reads: string[] = []
  const contentByPath = new Map<string, string | null>()
  const onChangeByPath = new Map<string, () => void>()

  const registry = createLoopTrackingRegistry({
    read: (path) => {
      reads.push(path)
      return contentByPath.get(path) ?? null
    },
    watch: (path, onChange) => {
      watched.push(path)
      onChangeByPath.set(path, onChange)
      return () => disposed.push(path)
    },
    resolveDoc: (path) => (path.endsWith(".md") ? markdownDoc : null),
    ...overrides,
  })

  return {
    registry,
    watched,
    disposed,
    reads,
    contentByPath,
    touch: (path) => onChangeByPath.get(path)?.(),
  }
}

describe("createLoopTrackingRegistry", () => {
  test("register warms the cache before it returns", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)

    h.registry.register("c1", "/w/PROGRESS.md")

    expect(h.registry.snapshot("c1")).toEqual({
      doneEntries: ["- 2026-08-06 chunk two DONE", "- 2026-08-05 chunk one DONE"],
      nextChunkSection: "## Next chunk\nchunk three",
    })
  })

  test("re-registering the same file does not re-arm the watcher", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)

    h.registry.register("c1", "/w/PROGRESS.md")
    h.registry.register("c1", "/w/PROGRESS.md")

    expect(h.watched).toEqual(["/w/PROGRESS.md"])
    expect(h.disposed).toEqual([])
  })

  test("registering a different file disposes the old watcher and arms the new one", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)
    h.contentByPath.set("/other/PLAN.md", DOC)

    h.registry.register("c1", "/w/PROGRESS.md")
    h.registry.register("c1", "/other/PLAN.md")

    expect(h.disposed).toEqual(["/w/PROGRESS.md"])
    expect(h.watched).toEqual(["/w/PROGRESS.md", "/other/PLAN.md"])
  })

  test("a file change re-reads and notifies every subscriber with the chat id", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)
    h.registry.register("c1", "/w/PROGRESS.md")
    const notified: string[] = []
    h.registry.subscribe((chatId) => notified.push(chatId))

    h.contentByPath.set(
      "/w/PROGRESS.md",
      DOC.replace("## Progress (latest first)\n", "## Progress (latest first)\n- 2026-08-07 chunk three DONE\n"),
    )
    h.touch("/w/PROGRESS.md")

    expect(notified).toEqual(["c1"])
    expect(h.registry.snapshot("c1")?.doneEntries[0]).toBe("- 2026-08-07 chunk three DONE")
  })

  test("unsubscribing stops the notifications", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)
    h.registry.register("c1", "/w/PROGRESS.md")
    const notified: string[] = []
    const unsubscribe = h.registry.subscribe((chatId) => notified.push(chatId))

    unsubscribe()
    h.touch("/w/PROGRESS.md")

    expect(notified).toEqual([])
  })

  test("an unreadable file and an unsupported format both read as no plan", () => {
    const h = harness()
    h.registry.register("unreadable", "/w/PROGRESS.md")
    h.contentByPath.set("/w/plan.rst", DOC)
    h.registry.register("wrong-format", "/w/plan.rst")

    expect(h.registry.snapshot("unreadable")).toBeNull()
    expect(h.registry.snapshot("wrong-format")).toBeNull()
  })

  test("snapshot is null for a chat that was never registered, and after unregister", () => {
    const h = harness()
    h.contentByPath.set("/w/PROGRESS.md", DOC)
    h.registry.register("c1", "/w/PROGRESS.md")

    expect(h.registry.snapshot("other")).toBeNull()

    h.registry.unregister("c1")
    expect(h.registry.snapshot("c1")).toBeNull()
    expect(h.disposed).toEqual(["/w/PROGRESS.md"])
  })

  test("only the newest entries are retained, so a long-running loop cannot grow the payload without bound", () => {
    const h = harness({ maxDoneEntries: 2 })
    h.contentByPath.set(
      "/w/PROGRESS.md",
      ["## Progress (latest first)", "- newest", "- middle", "- oldest", ""].join("\n"),
    )

    h.registry.register("c1", "/w/PROGRESS.md")

    expect(h.registry.snapshot("c1")?.doneEntries).toEqual(["- newest", "- middle"])
  })
})

describe("loop tracking end to end, over a real file", () => {
  const dirs: string[] = []
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  function workdir(): string {
    const d = mkdtempSync(join(tmpdir(), "loop-e2e-"))
    dirs.push(d)
    return d
  }

  test("a plan on disk becomes checklist rows, and a worker's append lands without a re-register", async () => {
    const dir = workdir()
    const file = join(dir, "PROGRESS.md")
    writeFileSync(file, DOC)

    const registry = createLoopTrackingRegistry({
      read: readTrackingFile,
      watch: (abs, onChange) => watchTrackingFile(abs, onChange, { debounceMs: 20 }),
      resolveDoc: (abs) => resolveStructuredDoc(extname(abs)),
    })
    const events: AutoContinueEvent[] = [{
      kind: "loop_armed",
      chatId: "c1",
      timestamp: 100,
      subagentId: "sa-1",
      prompt: "Do the next chunk",
      workdirAbs: dir,
      trackingFileRel: "PROGRESS.md",
    } as AutoContinueEvent]
    syncLoopTracking({ getAutoContinueEvents: () => events, registry }, "c1")

    const rowsNow = () =>
      buildLoopProgress({
        chatId: "c1",
        armed: true,
        loopArmedAt: 100,
        runs: [],
        rateLimit: null,
        tracking: registry.snapshot("c1"),
      }).rows.map((r) => [r.status, r.label])

    expect(rowsNow()).toEqual([
      ["done", "2026-08-05 chunk one DONE"],
      ["done", "2026-08-06 chunk two DONE"],
      ["pending", "chunk three"],
    ])

    const notified: string[] = []
    registry.subscribe((chatId) => notified.push(chatId))
    writeFileSync(
      file,
      markdownDoc.append(DOC, { section: "Progress", entry: "- 2026-08-07 chunk three DONE", position: "top" }).content,
    )
    await Bun.sleep(300)

    expect(notified).toContain("c1")
    expect(rowsNow()[2]).toEqual(["done", "2026-08-07 chunk three DONE"])

    registry.unregister("c1")
  }, 10_000)
})
