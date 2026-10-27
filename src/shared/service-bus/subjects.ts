import { BUS_SUBJECT_PREFIX, busSubject } from "./envelope"

export const BUS_SUBJECT_SUFFIX = {
  projectOpened: "project.opened",
  projectRemoved: "project.removed",
  projectDeleted: "project.deleted",
  projectStarred: "project.starred",
  projectInstructions: "project.instructions",
  chatCreated: "chat.created",
  chatProjectsAttached: "chat.projectsAttached",
  chatRenamed: "chat.renamed",
  chatDeleted: "chat.deleted",
  chatArchived: "chat.archived",
  chatUnarchived: "chat.unarchived",
  chatPinned: "chat.pinned",
  chatProvider: "chat.provider",
  chatModel: "chat.model",
  chatPlanMode: "chat.planMode",
  chatPolicy: "chat.policy",
  queueEnqueued: "queue.enqueued",
  queueRemoved: "queue.removed",
  turnStarted: "turn.started",
  turnFinished: "turn.finished",
  turnFailed: "turn.failed",
  turnCancelled: "turn.cancelled",
  stackAdded: "stack.added",
  stackRemoved: "stack.removed",
  stackRenamed: "stack.renamed",
  stackProjectAdded: "stack.projectAdded",
  stackProjectRemoved: "stack.projectRemoved",
  stackInstructions: "stack.instructions",
  subagentStarted: "subagent.started",
  subagentCompleted: "subagent.completed",
  subagentFailed: "subagent.failed",
  subagentCancelled: "subagent.cancelled",
  subagentToolPending: "subagent.toolPending",
  subagentToolResolved: "subagent.toolResolved",
  toolRequestPut: "toolRequest.put",
  toolRequestResolved: "toolRequest.resolved",
  autocontinueProposed: "autocontinue.proposed",
  autocontinueAccepted: "autocontinue.accepted",
  autocontinueRescheduled: "autocontinue.rescheduled",
  autocontinueCancelled: "autocontinue.cancelled",
  autocontinueFired: "autocontinue.fired",
  loopArmed: "loop.armed",
  loopRunOutcome: "loop.runOutcome",
  loopDisarmed: "loop.disarmed",
  cronArmed: "cron.armed",
  cronDisarmed: "cron.disarmed",
  cronPaused: "cron.paused",
  cronResumed: "cron.resumed",
  cronRunStarted: "cron.runStarted",
  cronRunOutcome: "cron.runOutcome",
  cronRunSkipped: "cron.runSkipped",
  taskCreated: "task.created",
  taskUpdated: "task.updated",
  taskDeleted: "task.deleted",
  taskClaimed: "task.claimed",
  taskRunBound: "task.runBound",
  taskSettled: "task.settled",
  taskIntegrated: "task.integrated",
  taskNote: "task.note",
  taskEpochAdvanced: "task.epochAdvanced",
  taskNativeSynced: "task.nativeSynced",
} as const

export type BusSubjectName = keyof typeof BUS_SUBJECT_SUFFIX

export const ALL_BUS_SUBJECTS = `${BUS_SUBJECT_PREFIX}.>`

const INBOX_FAMILY = "inbox"

export const INBOX_SUBJECT_PATTERN = `${BUS_SUBJECT_PREFIX}.${INBOX_FAMILY}.>`

export function subjectOfSuffix(suffix: string): string {
  return busSubject(...suffix.split("."))
}

export function namedBusSubject(name: BusSubjectName): string {
  return subjectOfSuffix(BUS_SUBJECT_SUFFIX[name])
}

export function transcriptBusSubject(kind: string): string {
  return busSubject("transcript", kind)
}

export function webhookDeliverySubject(hookId: string): string {
  return busSubject("webhook", hookId, "delivery")
}

export function mcpMessageSubject(sourceId: string): string {
  return busSubject("mcp", sourceId, "message")
}

export function inboxBusSubject(verb: string): string {
  return busSubject(INBOX_FAMILY, verb)
}

export function subjectFamily(subject: string): string {
  return subject.split(".")[1] ?? ""
}

export function isInboxSubject(subject: string): boolean {
  return subject.startsWith(`${BUS_SUBJECT_PREFIX}.${INBOX_FAMILY}.`)
}
