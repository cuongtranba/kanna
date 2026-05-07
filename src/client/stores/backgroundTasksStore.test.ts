import { beforeEach, describe, expect, test } from "bun:test"
import type { BackgroundTask } from "../../shared/types"
import {
  createBackgroundTasksStore,
  type BackgroundTasksStore,
} from "./backgroundTasksStore"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const taskA: BackgroundTask = {
  kind: "draining_stream",
  id: "a",
  chatId: "chat-1",
  startedAt: 0,
  lastOutput: "",
}

const taskB: BackgroundTask = {
  kind: "draining_stream",
  id: "b",
  chatId: "chat-1",
  startedAt: 0,
  lastOutput: "",
}

const taskC: BackgroundTask = {
  kind: "draining_stream",
  id: "c",
  chatId: "chat-2",
  startedAt: 0,
  lastOutput: "",
}

const taskBashRunning: BackgroundTask = {
  kind: "bash_shell",
  id: "bash-running",
  chatId: "chat-1",
  command: "echo hi",
  shellId: "s1",
  pid: 123,
  startedAt: 0,
  lastOutput: "",
  status: "running",
}

const taskBashStopping: BackgroundTask = {
  kind: "bash_shell",
  id: "bash-stopping",
  chatId: "chat-1",
  command: "sleep 5",
  shellId: "s2",
  pid: 456,
  startedAt: 0,
  lastOutput: "",
  status: "stopping",
}

const taskPty: BackgroundTask = {
  kind: "terminal_pty",
  id: "pty-1",
  ptyId: "pty-abc",
  cwd: "/tmp",
  startedAt: 0,
  lastOutput: "",
}

const taskCodex: BackgroundTask = {
  kind: "codex_session",
  id: "codex-1",
  chatId: "chat-2",
  pid: 789,
  startedAt: 0,
  lastOutput: "",
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("backgroundTasksStore", () => {
  let store: BackgroundTasksStore

  beforeEach(() => {
    store = createBackgroundTasksStore()
  })

  // -------------------------------------------------------------------------
  // applySnapshot
  // -------------------------------------------------------------------------

  describe("applySnapshot", () => {
    test("seeds tasks from snapshot", () => {
      store.getState().applySnapshot([taskA, taskB])
      expect(store.getState().tasks).toHaveLength(2)
    })

    test("completely replaces pre-existing state", () => {
      store.getState().applySnapshot([taskA, taskB])
      store.getState().applySnapshot([taskC])
      expect(store.getState().tasks).toHaveLength(1)
      expect(store.getState().tasks[0].id).toBe("c")
    })

    test("snapshot with empty array clears all tasks", () => {
      store.getState().applySnapshot([taskA])
      store.getState().applySnapshot([])
      expect(store.getState().tasks).toHaveLength(0)
    })
  })

  // -------------------------------------------------------------------------
  // applyDiff
  // -------------------------------------------------------------------------

  describe("applyDiff", () => {
    test("applies snapshot then added diff", () => {
      store.getState().applySnapshot([taskA])
      expect(store.getState().tasks).toHaveLength(1)
      store.getState().applyDiff({ op: "added", task: taskB })
      expect(store.getState().tasks).toHaveLength(2)
    })

    test("added diff appends task by id", () => {
      store.getState().applySnapshot([taskA])
      store.getState().applyDiff({ op: "added", task: taskB })
      const ids = store.getState().tasks.map((t) => t.id)
      expect(ids).toContain("a")
      expect(ids).toContain("b")
    })

    test("removed diff removes task by id", () => {
      store.getState().applySnapshot([taskA, taskB])
      store.getState().applyDiff({ op: "removed", task: taskA })
      expect(store.getState().tasks).toHaveLength(1)
      expect(store.getState().tasks[0].id).toBe("b")
    })

    test("updated diff updates lastOutput in place", () => {
      store.getState().applySnapshot([taskA])
      const updated: BackgroundTask = { ...taskA, lastOutput: "hello" }
      store.getState().applyDiff({ op: "updated", task: updated })
      expect(store.getState().tasks).toHaveLength(1)
      expect(store.getState().tasks[0].lastOutput).toBe("hello")
    })

    test("updated diff preserves other fields", () => {
      store.getState().applySnapshot([taskA, taskB])
      const updated: BackgroundTask = { ...taskA, lastOutput: "changed" }
      store.getState().applyDiff({ op: "updated", task: updated })
      expect(store.getState().tasks).toHaveLength(2)
      // taskB must be unchanged
      expect(store.getState().tasks.find((t) => t.id === "b")?.lastOutput).toBe("")
    })
  })

  // -------------------------------------------------------------------------
  // byChat selector
  // -------------------------------------------------------------------------

  describe("byChat selector", () => {
    test("returns tasks matching chatId", () => {
      store.getState().applySnapshot([taskA, taskB, taskC])
      const result = store.getState().byChat("chat-1")
      expect(result).toHaveLength(2)
      expect(result.every((t) => "chatId" in t && t.chatId === "chat-1")).toBe(true)
    })

    test("returns empty array when chatId has no tasks", () => {
      store.getState().applySnapshot([taskA])
      expect(store.getState().byChat("chat-99")).toHaveLength(0)
    })

    test("terminal_pty has no chatId — excluded from chat-1 query", () => {
      store.getState().applySnapshot([taskA, taskPty])
      const result = store.getState().byChat("chat-1")
      expect(result).toHaveLength(1)
      expect(result[0].id).toBe("a")
    })
  })

  // -------------------------------------------------------------------------
  // runningCount selector
  // Running rule:
  //   bash_shell with status="running"  → running
  //   bash_shell with status="stopping" → NOT running (draining, winding down)
  //   draining_stream                   → always running
  //   terminal_pty                      → always running
  //   codex_session                     → always running
  // -------------------------------------------------------------------------

  describe("runningCount selector", () => {
    test("counts bash_shell status=running as running", () => {
      store.getState().applySnapshot([taskBashRunning])
      expect(store.getState().runningCount).toBe(1)
    })

    test("does NOT count bash_shell status=stopping as running", () => {
      store.getState().applySnapshot([taskBashStopping])
      expect(store.getState().runningCount).toBe(0)
    })

    test("counts draining_stream as running", () => {
      store.getState().applySnapshot([taskA])
      expect(store.getState().runningCount).toBe(1)
    })

    test("counts terminal_pty as running", () => {
      store.getState().applySnapshot([taskPty])
      expect(store.getState().runningCount).toBe(1)
    })

    test("counts codex_session as running", () => {
      store.getState().applySnapshot([taskCodex])
      expect(store.getState().runningCount).toBe(1)
    })

    test("sums across mixed kinds", () => {
      store.getState().applySnapshot([taskBashRunning, taskA, taskPty, taskCodex, taskBashStopping])
      // bash_running + draining + pty + codex = 4; bash_stopping = 0
      expect(store.getState().runningCount).toBe(4)
    })

    test("returns 0 with empty store", () => {
      expect(store.getState().runningCount).toBe(0)
    })
  })
})
