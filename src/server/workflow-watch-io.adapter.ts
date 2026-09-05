import { existsSync, readdirSync, readFileSync, statSync, watch } from "node:fs"
import { join, dirname, basename } from "node:path"
import { isJsonObject, safeJsonParse, type JsonValue } from "../shared/json"

export interface WorkflowRawFile { runId: string; raw: JsonValue }

export interface WorkflowRunDirInfo { runId: string; newestMtimeMs: number }

function isWfFile(name: string): boolean { return name.startsWith("wf_") && name.endsWith(".json") }
function isWfDir(name: string): boolean { return name.startsWith("wf_") }

export function liveRunRoot(workflowsDir: string): string {
  return join(dirname(workflowsDir), "subagents", basename(workflowsDir))
}

export function listWorkflowRunDirs(workflowsDir: string): WorkflowRunDirInfo[] {
  const liveRoot = liveRunRoot(workflowsDir)
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
        } catch { }
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
      const raw = safeJsonParse(readFileSync(join(dir, name), "utf8"))
      if (raw === null) continue
      out.push({ runId: name.slice(0, -".json".length), raw })
    } catch {
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

export function watchWorkflowRunDirs(
  workflowsDir: string, onChange: () => void, opts?: { debounceMs?: number },
): () => void {
  return watchWorkflowDir(liveRunRoot(workflowsDir), onChange, opts)
}

export interface WorkflowJournalEntry {
  type: "started" | "result"
  agentId: string
  key?: string
  result?: {
    dir?: string
    fixed?: number
    stale?: number
    skipped?: number
    testsPass?: boolean
    test_status?: string
    summary?: string
    notes?: string
  }
}

const KNOWN_JOURNAL_KINDS: ReadonlySet<string> = new Set(["started", "result"])

function countOf(v: JsonValue | undefined): number | undefined {
  if (typeof v === "number") return v
  if (Array.isArray(v)) return v.length
  return undefined
}

function parseJournalLine(line: string): WorkflowJournalEntry | null {
  if (!line) return null
  const raw = safeJsonParse(line)
  if (raw === null || !isJsonObject(raw)) return null
  const r = raw
  const type = r.type
  const agentId = r.agentId
  if (typeof type !== "string" || !KNOWN_JOURNAL_KINDS.has(type)) return null
  if (typeof agentId !== "string") return null
  const journalType: "started" | "result" = type === "started" ? "started" : "result"
  const out: WorkflowJournalEntry = { type: journalType, agentId }
  if (typeof r.key === "string") out.key = r.key
  if (isJsonObject(r.result)) {
    const rr = r.result
    const res: WorkflowJournalEntry["result"] = {}
    if (typeof rr.dir === "string") res.dir = rr.dir
    const fixed = countOf(rr.fixed); if (fixed !== undefined) res.fixed = fixed
    const stale = countOf(rr.stale); if (stale !== undefined) res.stale = stale
    const skipped = countOf(rr.skipped); if (skipped !== undefined) res.skipped = skipped
    if (typeof rr.testsPass === "boolean") res.testsPass = rr.testsPass
    if (typeof rr.test_status === "string") res.test_status = rr.test_status
    if (typeof rr.summary === "string") res.summary = rr.summary
    if (typeof rr.notes === "string") res.notes = rr.notes
    out.result = res
  }
  return out
}

export function readWorkflowRunJournal(workflowsDir: string, runId: string): WorkflowJournalEntry[] {
  const journalPath = join(liveRunRoot(workflowsDir), runId, "journal.jsonl")
  if (!existsSync(journalPath)) return []
  let text: string
  try { text = readFileSync(journalPath, "utf8") } catch { return [] }
  const out: WorkflowJournalEntry[] = []
  for (const line of text.split("\n")) {
    const entry = parseJournalLine(line)
    if (entry) out.push(entry)
  }
  return out
}

export interface WatchWorkflowDeps {
  watch: typeof watch
  setTimeout: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void
  setInterval: (fn: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval: (handle: ReturnType<typeof setInterval>) => void
}

const DEFAULT_WATCH_DEPS: WatchWorkflowDeps = {
  watch,
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (handle) => clearTimeout(handle),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (handle) => clearInterval(handle),
}

export function watchWorkflowDir(
  dir: string,
  onChange: () => void,
  opts?: { debounceMs?: number; deps?: WatchWorkflowDeps; filterBasename?: string },
): () => void {
  const debounceMs = opts?.debounceMs ?? 250
  const filterBasename = opts?.filterBasename ?? null
  const deps = opts?.deps ?? DEFAULT_WATCH_DEPS
  let timer: ReturnType<typeof setTimeout> | null = null
  let disposed = false
  let watcher: ReturnType<typeof watch> | null = null
  let parentPoll: ReturnType<typeof setInterval> | null = null
  let promoted = false

  const fire = (_event?: string, filename?: string | Buffer | null) => {
    if (disposed) return
    if (filterBasename && typeof filename === "string" && filename !== filterBasename) return
    if (timer) deps.clearTimeout(timer)
    timer = deps.setTimeout(() => { timer = null; if (!disposed) onChange() }, debounceMs)
  }

  const closeWatcher = () => { try { watcher?.close() } catch { } watcher = null }
  const stopParentPoll = () => { if (parentPoll) { deps.clearInterval(parentPoll); parentPoll = null } }

  const armTarget = () => {
    if (disposed) return
    try { watcher = deps.watch(dir, { persistent: false }, fire) } catch { watcher = null }
  }

  const armParent = () => {
    if (disposed) return
    const ancestor = nearestExistingAncestor(dir)
    if (!ancestor) return
    const promote = () => {
      if (disposed || promoted || !existsSync(dir)) return
      promoted = true
      stopParentPoll()
      closeWatcher()
      armTarget()
      fire()
    }
    try {
      watcher = deps.watch(ancestor, { persistent: false }, promote)
    } catch { watcher = null }
    const pollMs = Math.max(20, Math.min(debounceMs, 100))
    parentPoll = deps.setInterval(promote, pollMs)
    parentPoll.unref?.()
  }

  if (existsSync(dir)) {
    armTarget()
    deps.setTimeout(() => fire(), 0)
  } else {
    armParent()
  }

  return () => {
    disposed = true
    if (timer) clearTimeout(timer)
    stopParentPoll()
    closeWatcher()
  }
}
