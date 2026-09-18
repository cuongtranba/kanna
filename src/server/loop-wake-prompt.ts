import type { ChatTaskNote, ChatTaskRecord } from "../shared/chat-tasks/types"

const MAX_TASK_ROWS = 40
const MAX_FAILURE_NOTES = 5
const MAX_SUBJECT = 80

function cap(text: string): string {
  return text.length <= MAX_SUBJECT ? text : `${text.slice(0, MAX_SUBJECT - 1).trimEnd()}…`
}

function mark(task: ChatTaskRecord): string {
  if (task.status === "completed") return "x"
  return task.status === "in_progress" ? "~" : " "
}

function suffix(task: ChatTaskRecord): string {
  const parts: string[] = []
  if (task.needs.length > 0) parts.push(`needs ${task.needs.join(", ")}`)
  if (task.runId !== null) parts.push(`run ${task.runId}`)
  else if (task.claimId !== null) parts.push("claimed")
  return parts.length > 0 ? `  (${parts.join("; ")})` : ""
}

function taskRows(tasks: readonly ChatTaskRecord[]): string[] {
  if (tasks.length <= MAX_TASK_ROWS) {
    return tasks.map((task) => `- [${mark(task)}] ${task.id} ${cap(task.subject)}${suffix(task)}`)
  }
  const head = tasks.slice(0, MAX_TASK_ROWS - 10)
  const tail = tasks.slice(tasks.length - 10)
  return [
    ...head.map((task) => `- [${mark(task)}] ${task.id} ${cap(task.subject)}${suffix(task)}`),
    `- … ${String(tasks.length - MAX_TASK_ROWS)} more tasks elided …`,
    ...tail.map((task) => `- [${mark(task)}] ${task.id} ${cap(task.subject)}${suffix(task)}`),
  ]
}

export function renderLoopStateBlock(args: {
  goal: string | null
  tasks: readonly ChatTaskRecord[]
  notes: readonly ChatTaskNote[]
}): string {
  const completed = args.tasks.filter((task) => task.status === "completed").length
  const running = args.tasks.filter((task) => task.status === "in_progress").length
  const pending = args.tasks.filter((task) => task.status === "pending").length

  const lines: string[] = ["<loop-state>"]
  if (args.goal !== null && args.goal.trim().length > 0) lines.push(`Goal: ${args.goal.trim()}`)
  lines.push(
    `Tasks (${String(args.tasks.length)}): ${String(completed)} completed · `
    + `${String(running)} in progress · ${String(pending)} pending`,
  )
  lines.push(...taskRows(args.tasks))

  const failures = args.notes
    .filter((note) => note.noteKind === "failed_approach")
    .slice(-MAX_FAILURE_NOTES)
  if (failures.length > 0) {
    lines.push("Recent failures:")
    for (const note of failures) {
      lines.push(`- ${note.taskId ?? "plan"} — ${cap(note.text)}`)
    }
  }
  lines.push("</loop-state>")
  return lines.join("\n")
}

export function composeLoopWakePrompt(args: {
  notice: string
  prompt: string
  goal: string | null
  tasks: readonly ChatTaskRecord[]
  notes: readonly ChatTaskNote[]
}): string {
  if (args.tasks.length === 0) return `${args.notice}\n\n${args.prompt}`
  const block = renderLoopStateBlock({ goal: args.goal, tasks: args.tasks, notes: args.notes })
  return `${args.notice}\n\n${block}\n\n${args.prompt}`
}
