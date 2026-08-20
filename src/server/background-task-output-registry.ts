import { OutputRing, OUTPUT_RING_DEFAULT_BYTES } from "./claude-pty/output-ring"

export interface BackgroundTaskOutputDeps {
  statSize(path: string): number | null
  readAppend(path: string, fromByte: number): { data: string; endByte: number }
  setInterval(fn: () => void, ms: number): () => void
}

export interface BackgroundTaskOutput {
  content: string
  truncated: boolean
}

export interface BackgroundTaskOutputRegistry {
  trackTask(chatId: string, taskId: string, outputPath: string | null): void
  untrackTask(chatId: string, taskId: string): void
  addWatcher(chatId: string, taskId: string): () => void
  getOutput(chatId: string, taskId: string): BackgroundTaskOutput | null
  subscribe(cb: (chatId: string, taskId: string) => void): () => void
}

const POLL_INTERVAL_MS = 1_000

interface TaskState {
  outputPath: string
  ring: OutputRing
  byteOffset: number
  watcherCount: number
  pollDispose: (() => void) | null
}

function taskKey(chatId: string, taskId: string): string {
  return `${chatId}\x00${taskId}`
}

export function createBackgroundTaskOutputRegistry(
  deps: BackgroundTaskOutputDeps,
): BackgroundTaskOutputRegistry {
  const tasks = new Map<string, TaskState>()
  const observers: Array<(chatId: string, taskId: string) => void> = []

  function notify(chatId: string, taskId: string): void {
    for (const cb of observers) cb(chatId, taskId)
  }

  function poll(chatId: string, taskId: string, state: TaskState): void {
    const size = deps.statSize(state.outputPath)
    if (size === null || size <= state.byteOffset) return
    const { data, endByte } = deps.readAppend(state.outputPath, state.byteOffset)
    if (!data) return
    state.byteOffset = endByte
    state.ring.append(data)
    notify(chatId, taskId)
  }

  function stopPoll(state: TaskState): void {
    state.pollDispose?.()
    state.pollDispose = null
  }

  function startPoll(chatId: string, taskId: string, state: TaskState): void {
    if (state.pollDispose !== null) return
    state.pollDispose = deps.setInterval(() => poll(chatId, taskId, state), POLL_INTERVAL_MS)
  }

  return {
    trackTask(chatId, taskId, outputPath) {
      if (outputPath === null) return
      const key = taskKey(chatId, taskId)
      if (tasks.has(key)) return
      tasks.set(key, {
        outputPath,
        ring: new OutputRing(OUTPUT_RING_DEFAULT_BYTES),
        byteOffset: 0,
        watcherCount: 0,
        pollDispose: null,
      })
    },

    untrackTask(chatId, taskId) {
      const key = taskKey(chatId, taskId)
      const state = tasks.get(key)
      if (!state) return
      stopPoll(state)
      tasks.delete(key)
    },

    addWatcher(chatId, taskId) {
      const key = taskKey(chatId, taskId)
      const state = tasks.get(key)
      if (!state) return () => {}
      state.watcherCount++
      if (state.watcherCount === 1) startPoll(chatId, taskId, state)
      return () => {
        state.watcherCount--
        if (state.watcherCount <= 0) {
          state.watcherCount = 0
          stopPoll(state)
        }
      }
    },

    getOutput(chatId, taskId) {
      const state = tasks.get(taskKey(chatId, taskId))
      if (!state) return null
      const content = state.ring.tail()
      const totalRead = state.byteOffset
      const truncated = totalRead > OUTPUT_RING_DEFAULT_BYTES
      return { content, truncated }
    },

    subscribe(cb) {
      observers.push(cb)
      return () => {
        const i = observers.indexOf(cb)
        if (i >= 0) observers.splice(i, 1)
      }
    },
  }
}
