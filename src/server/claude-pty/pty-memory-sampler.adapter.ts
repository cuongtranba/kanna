import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

const PS_TIMEOUT_MS = 2000

export interface PsProcessRow {
  pid: number
  ppid: number
  rssKb: number
  cpuPercent: number
}

export interface ProcessTreeSample {
  rssBytes: number
  cpuPercent: number
}

export function parsePsOutput(stdout: string): PsProcessRow[] {
  const rows: PsProcessRow[] = []
  for (const rawLine of stdout.split("\n")) {
    const line = rawLine.trim()
    if (!line) continue
    const parts = line.split(/\s+/)
    if (parts.length < 4) continue
    const pid = Number(parts[0])
    const ppid = Number(parts[1])
    const rssKb = Number(parts[2])
    const cpuPercent = Number(parts[3])
    if (!Number.isFinite(pid) || !Number.isFinite(ppid) || !Number.isFinite(rssKb) || !Number.isFinite(cpuPercent)) continue
    rows.push({ pid, ppid, rssKb, cpuPercent })
  }
  return rows
}

export function collectTreePids(rows: readonly PsProcessRow[], rootPid: number): Set<number> {
  const childrenByParent = new Map<number, number[]>()
  for (const row of rows) {
    const list = childrenByParent.get(row.ppid)
    if (list) list.push(row.pid)
    else childrenByParent.set(row.ppid, [row.pid])
  }
  const tree = new Set<number>([rootPid])
  const queue: number[] = [rootPid]
  while (queue.length > 0) {
    const next = queue.shift()
    if (next === undefined) break
    const kids = childrenByParent.get(next)
    if (!kids) continue
    for (const kid of kids) {
      if (tree.has(kid)) continue
      tree.add(kid)
      queue.push(kid)
    }
  }
  return tree
}

export function sumTreeUsage(rows: readonly PsProcessRow[], tree: ReadonlySet<number>): ProcessTreeSample {
  let totalKb = 0
  let totalCpu = 0
  for (const row of rows) {
    if (!tree.has(row.pid)) continue
    totalKb += row.rssKb
    totalCpu += row.cpuPercent
  }
  return { rssBytes: totalKb * 1024, cpuPercent: totalCpu }
}

export async function sampleProcessTreeUsage(rootPid: number): Promise<ProcessTreeSample | null> {
  let stdout: string
  try {
    const result = await execFileAsync("ps", ["-A", "-o", "pid=,ppid=,rss=,pcpu="], {
      timeout: PS_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
    })
    stdout = result.stdout
  } catch {
    return null
  }
  const rows = parsePsOutput(stdout)
  if (!rows.some((r) => r.pid === rootPid)) return null
  const tree = collectTreePids(rows, rootPid)
  return sumTreeUsage(rows, tree)
}
