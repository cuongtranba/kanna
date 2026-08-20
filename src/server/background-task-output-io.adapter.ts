import { statSync, openSync, readSync, closeSync } from "node:fs"
import type { BackgroundTaskOutputDeps } from "./background-task-output-registry"

function statSize(path: string): number | null {
  try {
    return statSync(path).size
  } catch {
    return null
  }
}

function readAppend(path: string, fromByte: number): { data: string; endByte: number } {
  try {
    const size = statSync(path).size
    if (size <= fromByte) return { data: "", endByte: fromByte }
    const length = size - fromByte
    const buf = Buffer.alloc(length)
    const fd = openSync(path, "r")
    try {
      readSync(fd, buf, 0, length, fromByte)
    } finally {
      closeSync(fd)
    }
    return { data: buf.toString("utf8"), endByte: size }
  } catch {
    return { data: "", endByte: fromByte }
  }
}

function scheduleInterval(fn: () => void, ms: number): () => void {
  const id = setInterval(fn, ms)
  return () => clearInterval(id)
}

export const backgroundTaskOutputIo: BackgroundTaskOutputDeps = {
  statSize,
  readAppend,
  setInterval: scheduleInterval,
}
