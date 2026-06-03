import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs"
import { join, dirname, basename } from "node:path"

export interface WorkflowRawFile { runId: string; raw: unknown }

/** Liveness probe for an in-flight run, derived from its live transcript dir. */
export interface WorkflowRunDirInfo { runId: string; newestMtimeMs: number }

function isWfFile(name: string): boolean { return name.startsWith("wf_") && name.endsWith(".json") }
function isWfDir(name: string): boolean { return name.startsWith("wf_") }

/**
 * List the LIVE run directories Claude writes under the sibling
 * `<session>/subagents/workflows/wf_<runId>/` (one per run, holding
 * `journal.jsonl` + per-agent `agent-*.jsonl`). These are written from the
 * first second of a run, UNLIKE the terminal `workflows/wf_<runId>.json`
 * sidecar which Claude only flushes at/near termination. `newestMtimeMs` is
 * the max mtime across the run dir's files — the run's last on-disk activity.
 *
 * `workflowsDir` is the sidecar dir the registry already tracks
 * (`<session>/workflows`); the live dirs are its `../subagents/workflows`
 * sibling. Returns [] if the sibling does not exist yet.
 */
export function listWorkflowRunDirs(workflowsDir: string): WorkflowRunDirInfo[] {
  const sessionDir = dirname(workflowsDir)
  const liveRoot = join(sessionDir, "subagents", basename(workflowsDir))
  if (!existsSync(liveRoot)) return []
  let names: string[]
  try { names = readdirSync(liveRoot) } catch { return [] }
  const out: WorkflowRunDirInfo[] = []
  for (const name of names) {
    if (!isWfDir(name)) continue
    const runDir = join(liveRoot, name)
    let newest = 0
    try {
      for (const f of readdirSync(runDir)) {
        try {
          const m = statSync(join(runDir, f)).mtimeMs
          if (m > newest) newest = m
        } catch { /* file vanished mid-scan — skip */ }
      }
    } catch { continue }
    out.push({ runId: name, newestMtimeMs: newest })
  }
  return out
}

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
