import { describe, expect, test, beforeEach } from "bun:test"
import {
  sameDiffs,
  shouldPreserveExistingProjectDiffs,
  transitionUpdateRestart,
  UpdateRestartRuntime,
  type UpdateRestartSnapshot,
} from "./appRuntime"
import type { ChatDiffSnapshot } from "../../shared/types"
import type { StoragePort } from "../ports/storagePort"
import type { DomPort } from "../ports/domPort"
import type { TimerPort } from "../ports/timerPort"


function makeMinimalDiff(overrides?: Partial<ChatDiffSnapshot>): ChatDiffSnapshot {
  return {
    status: "ready",
    files: [],
    ...overrides,
  }
}

describe("sameDiffs", () => {
  test("identical reference returns true", () => {
    const diff = makeMinimalDiff()
    expect(sameDiffs(diff, diff)).toBe(true)
  })

  test("null equals null", () => {
    expect(sameDiffs(null, null)).toBe(true)
  })

  test("null vs object returns false", () => {
    expect(sameDiffs(null, makeMinimalDiff())).toBe(false)
    expect(sameDiffs(makeMinimalDiff(), null)).toBe(false)
  })

  test("undefined vs object returns false", () => {
    expect(sameDiffs(undefined, makeMinimalDiff())).toBe(false)
  })

  test("structurally identical objects return true", () => {
    const left = makeMinimalDiff()
    const right = makeMinimalDiff()
    expect(sameDiffs(left, right)).toBe(true)
  })

  test("different status returns false", () => {
    expect(sameDiffs(makeMinimalDiff({ status: "ready" }), makeMinimalDiff({ status: "unknown" }))).toBe(false)
  })

  test("different branchName returns false", () => {
    expect(sameDiffs(makeMinimalDiff({ branchName: "main" }), makeMinimalDiff({ branchName: "feat" }))).toBe(false)
  })

  test("different aheadCount returns false", () => {
    expect(sameDiffs(makeMinimalDiff({ aheadCount: 0 }), makeMinimalDiff({ aheadCount: 1 }))).toBe(false)
  })

  test("files with different paths return false", () => {
    const left = makeMinimalDiff({ files: [{ path: "a.ts", changeType: "modified", isUntracked: false, additions: 1, deletions: 0, patchDigest: "x", mimeType: "text/plain", size: 10 }] })
    const right = makeMinimalDiff({ files: [{ path: "b.ts", changeType: "modified", isUntracked: false, additions: 1, deletions: 0, patchDigest: "x", mimeType: "text/plain", size: 10 }] })
    expect(sameDiffs(left, right)).toBe(false)
  })

  test("files with different patchDigest return false", () => {
    const file = { path: "a.ts", changeType: "modified" as const, isUntracked: false, additions: 1, deletions: 0, patchDigest: "x", mimeType: "text/plain", size: 10 }
    const left = makeMinimalDiff({ files: [file] })
    const right = makeMinimalDiff({ files: [{ ...file, patchDigest: "y" }] })
    expect(sameDiffs(left, right)).toBe(false)
  })

  test("different file count returns false", () => {
    const file = { path: "a.ts", changeType: "modified" as const, isUntracked: false, additions: 1, deletions: 0, patchDigest: "x", mimeType: "text/plain", size: 10 }
    expect(sameDiffs(makeMinimalDiff({ files: [] }), makeMinimalDiff({ files: [file] }))).toBe(false)
  })

  test("identical branch history returns true", () => {
    const history = { entries: [{ sha: "abc", summary: "feat", description: "", authorName: "dev", authoredAt: "2024-01-01", tags: [] }] }
    const left = makeMinimalDiff({ branchHistory: history })
    const right = makeMinimalDiff({ branchHistory: history })
    expect(sameDiffs(left, right)).toBe(true)
  })

  test("different branch history sha returns false", () => {
    const base = { summary: "feat", description: "", authorName: "dev", authoredAt: "2024-01-01", tags: [] }
    const left = makeMinimalDiff({ branchHistory: { entries: [{ ...base, sha: "abc" }] } })
    const right = makeMinimalDiff({ branchHistory: { entries: [{ ...base, sha: "xyz" }] } })
    expect(sameDiffs(left, right)).toBe(false)
  })
})


describe("shouldPreserveExistingProjectDiffs", () => {
  test("returns false when current is null", () => {
    expect(shouldPreserveExistingProjectDiffs(null, makeMinimalDiff({ status: "unknown", files: [] }))).toBe(false)
  })

  test("returns false when next is null", () => {
    expect(shouldPreserveExistingProjectDiffs(makeMinimalDiff({ status: "ready" }), null)).toBe(false)
  })

  test("returns false when current status is unknown", () => {
    expect(shouldPreserveExistingProjectDiffs(
      makeMinimalDiff({ status: "unknown" }),
      makeMinimalDiff({ status: "unknown", files: [] }),
    )).toBe(false)
  })

  test("returns false when next status is not unknown", () => {
    expect(shouldPreserveExistingProjectDiffs(
      makeMinimalDiff({ status: "ready" }),
      makeMinimalDiff({ status: "no_repo" }),
    )).toBe(false)
  })

  test("returns false when next has files", () => {
    const file = { path: "a.ts", changeType: "modified" as const, isUntracked: false, additions: 1, deletions: 0, patchDigest: "x", mimeType: "text/plain", size: 10 }
    expect(shouldPreserveExistingProjectDiffs(
      makeMinimalDiff({ status: "ready" }),
      makeMinimalDiff({ status: "unknown", files: [file] }),
    )).toBe(false)
  })

  test("returns true when current is non-unknown and next is unknown with no files", () => {
    expect(shouldPreserveExistingProjectDiffs(
      makeMinimalDiff({ status: "ready" }),
      makeMinimalDiff({ status: "unknown", files: [] }),
    )).toBe(true)
  })

  test("returns true for dirty current → unknown next", () => {
    expect(shouldPreserveExistingProjectDiffs(
      makeMinimalDiff({ status: "no_repo" }),
      makeMinimalDiff({ status: "unknown", files: [] }),
    )).toBe(true)
  })
})


describe("transitionUpdateRestart", () => {
  test("idle + reload_requested (new) → awaiting_disconnect", () => {
    expect(transitionUpdateRestart("idle", {
      kind: "reload_requested",
      reloadRequestedAt: 1000,
      lastHandled: null,
    })).toBe("awaiting_disconnect")
  })

  test("idle + reload_requested (already handled) → idle", () => {
    expect(transitionUpdateRestart("idle", {
      kind: "reload_requested",
      reloadRequestedAt: 1000,
      lastHandled: "1000",
    })).toBe("idle")
  })

  test("awaiting_disconnect + disconnected → awaiting_server_ready", () => {
    expect(transitionUpdateRestart("awaiting_disconnect", {
      kind: "connection_status_changed",
      connectionStatus: "disconnected",
    })).toBe("awaiting_server_ready")
  })

  test("idle + update_initiated → awaiting_disconnect", () => {
    expect(transitionUpdateRestart("idle", { kind: "update_initiated" })).toBe("awaiting_disconnect")
  })

  test("awaiting_disconnect + update_initiated → awaiting_disconnect (idempotent)", () => {
    expect(transitionUpdateRestart("awaiting_disconnect", { kind: "update_initiated" })).toBe("awaiting_disconnect")
  })

  test("awaiting_disconnect + connected → no change", () => {
    expect(transitionUpdateRestart("awaiting_disconnect", {
      kind: "connection_status_changed",
      connectionStatus: "connected",
    })).toBe("awaiting_disconnect")
  })

  test("idle + disconnected → idle (runtime not waiting for disconnect)", () => {
    expect(transitionUpdateRestart("idle", {
      kind: "connection_status_changed",
      connectionStatus: "disconnected",
    })).toBe("idle")
  })

  test("awaiting_server_ready + server_ready → idle", () => {
    expect(transitionUpdateRestart("awaiting_server_ready", { kind: "server_ready" })).toBe("idle")
  })

  test("awaiting_disconnect + aborted → idle", () => {
    expect(transitionUpdateRestart("awaiting_disconnect", { kind: "aborted" })).toBe("idle")
  })

  test("awaiting_server_ready + aborted → idle", () => {
    expect(transitionUpdateRestart("awaiting_server_ready", { kind: "aborted" })).toBe("idle")
  })

  test("update_status_changed does not affect phase", () => {
    expect(transitionUpdateRestart("awaiting_disconnect", {
      kind: "update_status_changed",
      updateStatus: "updating",
    })).toBe("awaiting_disconnect")
  })
})


function makeStorage(initial: Record<string, string> = {}): StoragePort {
  const store = new Map(Object.entries(initial))
  return {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => { store.set(k, v) },
    removeItem: (k) => { store.delete(k) },
    clear: () => { store.clear() },
  }
}

function makeDom(): DomPort & { reloaded: number } {
  const dom = {
    reloaded: 0,
    reload: () => { dom.reloaded++ },
    addWindowListener: () => () => {},
    addDocumentListener: () => () => {},
  }
  return dom as unknown as DomPort & { reloaded: number }
}

function makeTimer(): TimerPort & { pendingCallbacks: Map<number, () => void> } {
  let nextId = 1
  const pending = new Map<number, () => void>()
  return {
    pendingCallbacks: pending,
    setTimeout: (fn: () => void, _ms: number) => {
      const id = nextId++
      pending.set(id, fn)
      return id
    },
    clearTimeout: (id: number) => { pending.delete(id) },
    setInterval: () => 0,
    clearInterval: () => {},
  } as unknown as TimerPort & { pendingCallbacks: Map<number, () => void> }
}

describe("UpdateRestartRuntime", () => {
  let storage: StoragePort
  let dom: DomPort & { reloaded: number }
  let timer: TimerPort & { pendingCallbacks: Map<number, () => void> }
  let snapshots: UpdateRestartSnapshot[]
  let runtime: UpdateRestartRuntime

  beforeEach(() => {
    storage = makeStorage()
    dom = makeDom()
    timer = makeTimer()
    snapshots = []
    runtime = new UpdateRestartRuntime(
      { storage, dom, timer, onSnapshot: (s) => snapshots.push(s) },
      { isServerReady: async () => false },
    )
  })

  test("initial phase is idle when no persisted phase", () => {
    expect(runtime.getSnapshot().phase).toBe("idle")
    expect(runtime.getSnapshot().activity.active).toBe(false)
  })

  test("restores awaiting_disconnect phase from persisted storage", () => {
    const s = makeStorage({ "kanna:ui-update-restart": "awaiting_disconnect" })
    const r = new UpdateRestartRuntime(
      { storage: s, dom, timer, onSnapshot: () => {} },
      { isServerReady: async () => false },
    )
    expect(r.getSnapshot().phase).toBe("awaiting_disconnect")
  })

  test("restores awaiting_server_ready phase from persisted storage", () => {
    const s = makeStorage({ "kanna:ui-update-restart": "awaiting_server_ready" })
    const r = new UpdateRestartRuntime(
      { storage: s, dom, timer, onSnapshot: () => {} },
      { isServerReady: async () => false },
    )
    expect(r.getSnapshot().phase).toBe("awaiting_server_ready")
  })

  test("idle → awaiting_disconnect on update_initiated", () => {
    runtime.dispatch({ kind: "update_initiated" })
    expect(runtime.getSnapshot().phase).toBe("awaiting_disconnect")
  })

  test("idle → awaiting_disconnect on new reload_requested", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: null })
    expect(runtime.getSnapshot().phase).toBe("awaiting_disconnect")
    expect(snapshots.at(-1)?.phase).toBe("awaiting_disconnect")
  })

  test("reload_requested already handled does not change phase", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: "1000" })
    expect(runtime.getSnapshot().phase).toBe("idle")
    expect(snapshots).toHaveLength(0)
  })

  test("stores last-handled reload request on transition", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1234, lastHandled: null })
    expect(UpdateRestartRuntime.getLastHandledReloadRequest(storage)).toBe("1234")
  })

  test("persists phase to storage on transition", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: null })
    expect(storage.getItem("kanna:ui-update-restart")).toBe("awaiting_disconnect")
  })

  test("awaiting_disconnect + disconnected → awaiting_server_ready", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: null })
    runtime.dispatch({ kind: "connection_status_changed", connectionStatus: "disconnected" })
    expect(runtime.getSnapshot().phase).toBe("awaiting_server_ready")
  })

  test("activity is active with label during awaiting_disconnect", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: null })
    const snap = runtime.getSnapshot()
    expect(snap.activity.active).toBe(true)
    expect(snap.activity.label).toBe("Re-deploying Kanna")
  })

  test("activity is active with 'Installing update' during update_status updating", () => {
    runtime.dispatch({ kind: "update_status_changed", updateStatus: "updating" })
    expect(runtime.getSnapshot().activity.active).toBe(true)
    expect(runtime.getSnapshot().activity.label).toBe("Installing update")
  })

  test("aborted resets to idle", () => {
    runtime.dispatch({ kind: "reload_requested", reloadRequestedAt: 1000, lastHandled: null })
    runtime.dispatch({ kind: "aborted" })
    expect(runtime.getSnapshot().phase).toBe("idle")
    expect(storage.getItem("kanna:ui-update-restart")).toBeNull()
  })

  test("server_ready triggers dom.reload and returns to idle", async () => {
    const s = makeStorage({ "kanna:ui-update-restart": "awaiting_server_ready" })
    let resolveReady!: () => void
    const isServerReady = () => new Promise<boolean>((res) => { resolveReady = () => res(true) })
    const r = new UpdateRestartRuntime(
      { storage: s, dom, timer, onSnapshot: (snap) => snapshots.push(snap) },
      { isServerReady },
    )
    resolveReady()
    for (let i = 0; i < 5; i++) await Promise.resolve()
    expect(dom.reloaded).toBe(1)
    expect(r.getSnapshot().phase).toBe("idle")
  })

  test("close cancels polling", () => {
    storage.setItem("kanna:ui-update-restart", "awaiting_server_ready")
    const r = new UpdateRestartRuntime(
      { storage, dom, timer, onSnapshot: () => {} },
      { isServerReady: async () => true },
    )
    r.close()
    expect(dom.reloaded).toBe(0)
  })

  test("emits snapshot on update_status_changed", () => {
    runtime.dispatch({ kind: "update_status_changed", updateStatus: "updating" })
    expect(snapshots).toHaveLength(1)
    expect(snapshots[0]?.activity.active).toBe(true)
  })

  test("does not emit duplicate snapshots when phase unchanged", () => {
    runtime.dispatch({ kind: "update_status_changed", updateStatus: null })
    runtime.dispatch({ kind: "update_status_changed", updateStatus: null })
    expect(snapshots).toHaveLength(0)
  })
})
