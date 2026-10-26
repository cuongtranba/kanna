import { execFile } from "node:child_process"
import { monitorEventLoopDelay } from "node:perf_hooks"
import { promisify } from "node:util"
import {
  eventLoopDelayFromNanos,
  summarizeChildProcesses,
  type ChildProcessUsage,
  type EventLoopDelay,
  type ProcessVitals,
} from "./process-vitals"

const execFileAsync = promisify(execFile)

const PS_ARGS = ["-A", "-o", "pid=,ppid=,rss=,comm="]
const PS_TIMEOUT_MS = 2_000
const PS_MAX_BUFFER_BYTES = 4 * 1024 * 1024
const EVENT_LOOP_RESOLUTION_MS = 20

export interface ProcessVitalsSamplerOptions {
  intervalMs: number
}

export interface ProcessVitalsSampler {
  latest(): ProcessVitals
  sample(): Promise<ProcessVitals>
  stop(): void
}

async function readChildProcesses(): Promise<ChildProcessUsage[] | null> {
  try {
    const pending = execFileAsync("ps", PS_ARGS, {
      timeout: PS_TIMEOUT_MS,
      maxBuffer: PS_MAX_BUFFER_BYTES,
    })
    const samplerPids = new Set<number>(pending.child.pid === undefined ? [] : [pending.child.pid])
    const { stdout } = await pending
    return summarizeChildProcesses(stdout, process.pid, samplerPids)
  } catch {
    return null
  }
}

export function startProcessVitalsSampler(options: ProcessVitalsSamplerOptions): ProcessVitalsSampler {
  const histogram = monitorEventLoopDelay({ resolution: EVENT_LOOP_RESOLUTION_MS })
  histogram.enable()
  let cached: ProcessVitals = { eventLoop: null, children: null }
  let inFlight: Promise<ProcessVitals> | null = null

  const readEventLoop = (): EventLoopDelay | null => {
    const delay = histogram.count > 0
      ? eventLoopDelayFromNanos(histogram.percentile(50), histogram.percentile(99), histogram.max)
      : null
    histogram.reset()
    return delay
  }

  const sample = (): Promise<ProcessVitals> => {
    if (inFlight) return inFlight
    const eventLoop = readEventLoop()
    inFlight = readChildProcesses()
      .then((children) => {
        cached = { eventLoop, children }
        return cached
      })
      .finally(() => {
        inFlight = null
      })
    return inFlight
  }

  const timer = setInterval(() => {
    if (inFlight) return
    void sample()
  }, options.intervalMs)
  timer.unref()

  return {
    latest: () => cached,
    sample,
    stop() {
      clearInterval(timer)
      histogram.disable()
    },
  }
}
