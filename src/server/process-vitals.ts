export type ChildProcessKind =
  | "claude"
  | "codex"
  | "nats-server"
  | "cloudflared"
  | "git"
  | "shell"
  | "bun"
  | "node"
  | "other"

export interface ChildProcessUsage {
  kind: ChildProcessKind
  rssBytes: number
  count: number
}

export interface EventLoopDelay {
  p50Ms: number
  p99Ms: number
  maxMs: number
}

export interface ProcessVitals {
  eventLoop: EventLoopDelay | null
  children: ChildProcessUsage[] | null
}

interface PsRow {
  pid: number
  ppid: number
  rssKib: number
  command: string
}

const PS_ROW = /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.+?)\s*$/

const SHELL_NAMES: ReadonlySet<string> = new Set(["sh", "bash", "zsh", "dash"])

const NAMED_KINDS: ReadonlyMap<string, ChildProcessKind> = new Map([
  ["claude", "claude"],
  ["codex", "codex"],
  ["nats-server", "nats-server"],
  ["cloudflared", "cloudflared"],
  ["git", "git"],
  ["bun", "bun"],
  ["node", "node"],
])

const NANOS_PER_MS = 1_000_000

function parsePsRows(stdout: string): PsRow[] {
  const rows: PsRow[] = []
  for (const line of stdout.split("\n")) {
    const match = PS_ROW.exec(line)
    if (!match) continue
    rows.push({
      pid: Number(match[1]),
      ppid: Number(match[2]),
      rssKib: Number(match[3]),
      command: match[4] ?? "",
    })
  }
  return rows
}

function classifyCommand(command: string): ChildProcessKind {
  const basename = command.slice(command.lastIndexOf("/") + 1).toLowerCase()
  if (SHELL_NAMES.has(basename)) return "shell"
  return NAMED_KINDS.get(basename) ?? "other"
}

export function summarizeChildProcesses(
  psStdout: string,
  rootPid: number,
  excludePids: ReadonlySet<number> = new Set(),
): ChildProcessUsage[] {
  const rows = parsePsRows(psStdout)
  const rowByPid = new Map<number, PsRow>()
  const childrenByParent = new Map<number, PsRow[]>()
  for (const row of rows) {
    rowByPid.set(row.pid, row)
    const siblings = childrenByParent.get(row.ppid)
    if (siblings) siblings.push(row)
    else childrenByParent.set(row.ppid, [row])
  }
  if (!rowByPid.has(rootPid)) return []

  const totals = new Map<ChildProcessKind, ChildProcessUsage>()
  const visited = new Set<number>([rootPid])
  const queue: Array<{ row: PsRow; kind: ChildProcessKind }> = []
  const enqueueChildren = (parentPid: number, inheritedKind: ChildProcessKind | null) => {
    for (const row of childrenByParent.get(parentPid) ?? []) {
      if (visited.has(row.pid) || excludePids.has(row.pid)) continue
      visited.add(row.pid)
      queue.push({ row, kind: inheritedKind ?? classifyCommand(row.command) })
    }
  }
  enqueueChildren(rootPid, null)
  for (let next = queue.shift(); next; next = queue.shift()) {
    const usage = totals.get(next.kind) ?? { kind: next.kind, rssBytes: 0, count: 0 }
    usage.rssBytes += next.row.rssKib * 1024
    usage.count += 1
    totals.set(next.kind, usage)
    enqueueChildren(next.row.pid, next.kind)
  }
  return [...totals.values()]
}

export function eventLoopDelayFromNanos(p50: number, p99: number, max: number): EventLoopDelay | null {
  if (![p50, p99, max].every(Number.isFinite)) return null
  return { p50Ms: p50 / NANOS_PER_MS, p99Ms: p99 / NANOS_PER_MS, maxMs: max / NANOS_PER_MS }
}
