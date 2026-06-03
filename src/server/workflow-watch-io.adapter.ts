import { existsSync, readdirSync, readFileSync, watch } from "node:fs"
import { join } from "node:path"

export interface WorkflowRawFile { runId: string; raw: unknown }

function isWfFile(name: string): boolean { return name.startsWith("wf_") && name.endsWith(".json") }

export function readWorkflowDir(dir: string): WorkflowRawFile[] {
  if (!existsSync(dir)) return []
  let names: string[]
  try { names = readdirSync(dir) } catch { return [] }
  const out: WorkflowRawFile[] = []
  for (const name of names) {
    if (!isWfFile(name)) continue
    try {
      const raw: unknown = JSON.parse(readFileSync(join(dir, name), "utf8"))
      out.push({ runId: name.slice(0, -".json".length), raw })
    } catch {
      // partial write / corrupt file — skip this tick; next write re-fires the watch
    }
  }
  return out
}

export function watchWorkflowDir(
  dir: string, onChange: () => void, opts?: { debounceMs?: number },
): () => void {
  const debounceMs = opts?.debounceMs ?? 250
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  const fire = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!disposed) onChange() }, debounceMs)
  }
  let watcher: ReturnType<typeof watch> | null = null
  try {
    if (existsSync(dir)) watcher = watch(dir, { persistent: false }, fire)
  } catch {
    watcher = null
  }
  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    try { watcher?.close() } catch { /* already closed */ }
  }
}
