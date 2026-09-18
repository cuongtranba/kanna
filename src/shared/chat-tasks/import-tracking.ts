export interface ImportedTask {
  readonly subject: string
  readonly completed: boolean
  readonly needs: readonly string[]
  readonly worktree: string | null
  readonly branch: string | null
  readonly sourceId: string | null
}

export interface ImportedPlan {
  readonly tasks: readonly ImportedTask[]
  readonly failedApproaches: readonly string[]
}

const HEADING = /^#{1,6}\s+(.*)$/
const BULLET = /^\s*[-*+]\s+(.*)$/
const CHECKBOX = /^\[([ ~xX])\]\s*(.*)$/

function sectionBody(content: string, heading: string): string[] {
  const lines = content.split("\n")
  const wanted = heading.trim().toLowerCase()
  const out: string[] = []
  let inside = false
  for (const line of lines) {
    const match = HEADING.exec(line)
    if (match) {
      if (inside) break
      inside = (match[1] ?? "").trim().toLowerCase() === wanted
      continue
    }
    if (inside) out.push(line)
  }
  return out
}

function parseMeta(segments: readonly string[]): {
  needs: string[]
  worktree: string | null
  branch: string | null
} {
  const meta: { needs: string[]; worktree: string | null; branch: string | null } = {
    needs: [],
    worktree: null,
    branch: null,
  }
  for (const segment of segments) {
    const trimmed = segment.trim()
    const colon = trimmed.indexOf(":")
    if (colon < 0) continue
    const key = trimmed.slice(0, colon).trim().toLowerCase()
    const value = trimmed.slice(colon + 1).trim()
    if (key === "needs") meta.needs = value.split(",").map((n) => n.trim()).filter((n) => n.length > 0)
    else if (key === "worktree") meta.worktree = value.length > 0 ? value : null
    else if (key === "branch") meta.branch = value.length > 0 ? value : null
  }
  return meta
}

function parseQueueLine(body: string): ImportedTask | null {
  const box = CHECKBOX.exec(body)
  if (!box) return null
  const completed = (box[1] ?? " ").toLowerCase() === "x"
  const segments = (box[2] ?? "").split(" | ")
  const head = (segments[0] ?? "").trim()
  if (head.length === 0) return null
  const meta = parseMeta(segments.slice(1))
  const space = head.search(/\s/)
  const sourceId = space < 0 ? head : head.slice(0, space)
  const subject = space < 0 ? head : head.slice(space + 1).trim()
  return {
    subject: subject.length > 0 ? subject : head,
    completed,
    needs: meta.needs,
    worktree: meta.worktree,
    branch: meta.branch,
    sourceId: space < 0 ? null : sourceId,
  }
}

function bulletTexts(lines: readonly string[]): string[] {
  const out: string[] = []
  for (const line of lines) {
    const bullet = BULLET.exec(line)
    if (bullet) out.push((bullet[1] ?? "").trim())
  }
  return out
}

export function importTrackingFileAsPlan(content: string): ImportedPlan {
  const queue = bulletTexts(sectionBody(content, "Task queue"))
    .map(parseQueueLine)
    .filter((task): task is ImportedTask => task !== null)

  const tasks: ImportedTask[] = [...queue]

  if (tasks.length === 0) {
    const nextChunk = sectionBody(content, "Next chunk")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
    const first = nextChunk[0]
    if (first !== undefined && first.toUpperCase() !== "DONE") {
      const stripped = first.replace(/^(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s+)/, "").trim()
      tasks.push({
        subject: stripped.length > 0 ? stripped : first,
        completed: false,
        needs: [],
        worktree: null,
        branch: null,
        sourceId: null,
      })
    }
  }

  return {
    tasks,
    failedApproaches: bulletTexts(sectionBody(content, "Failed approaches")),
  }
}
