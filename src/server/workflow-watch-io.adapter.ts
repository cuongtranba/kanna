import { existsSync, readdirSync, readFileSync, watch } from "node:fs"
import { join, dirname } from "node:path"

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

function nearestExistingAncestor(dir: string): string | null {
  let cur = dir
  for (let i = 0; i < 64; i++) {
    const parent = dirname(cur)
    if (parent === cur) return existsSync(cur) ? cur : null
    if (existsSync(parent)) return parent
    cur = parent
  }
  return null
}

export function watchWorkflowDir(
  dir: string, onChange: () => void, opts?: { debounceMs?: number },
): () => void {
  const debounceMs = opts?.debounceMs ?? 250
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let watcher: ReturnType<typeof watch> | null = null

  const fire = () => {
    if (disposed) return
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => { timer = null; if (!disposed) onChange() }, debounceMs)
  }

  const closeWatcher = () => { try { watcher?.close() } catch { /* already closed */ } watcher = null }

  const armTarget = () => {
    if (disposed) return
    try { watcher = watch(dir, { persistent: false }, fire) } catch { watcher = null }
  }

  const armParent = () => {
    if (disposed) return
    const ancestor = nearestExistingAncestor(dir)
    if (!ancestor) return
    try {
      watcher = watch(ancestor, { persistent: false }, () => {
        if (disposed || !existsSync(dir)) return
        closeWatcher()
        armTarget()
        fire() // the dir just appeared — trigger an initial read
      })
    } catch { watcher = null }
  }

  if (existsSync(dir)) armTarget()
  else armParent()

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    closeWatcher()
  }
}
