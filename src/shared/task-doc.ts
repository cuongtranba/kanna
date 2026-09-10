export const TASK_DOC_SECTIONS = {
  objective: "Objective",
  acceptanceCriteria: "Acceptance criteria",
  status: "Status",
  completed: "Completed",
  remaining: "Remaining",
  decisions: "Decisions",
  failedApproaches: "Failed approaches",
  unresolvedErrors: "Unresolved errors",
} as const

const SKELETON_SECTIONS: readonly { heading: string; hint: string }[] = [
  { heading: TASK_DOC_SECTIONS.objective, hint: "_What this task is for, in one or two sentences._" },
  { heading: TASK_DOC_SECTIONS.acceptanceCriteria, hint: "_What must be true before this can be called done._" },
  { heading: TASK_DOC_SECTIONS.status, hint: "_Current phase, and whether it is in progress or blocked._" },
  { heading: TASK_DOC_SECTIONS.completed, hint: "_Work already finished, so it is never redone._" },
  { heading: TASK_DOC_SECTIONS.remaining, hint: "_Work still outstanding._" },
  { heading: TASK_DOC_SECTIONS.decisions, hint: "_Each decision and the reason for it._" },
  { heading: TASK_DOC_SECTIONS.failedApproaches, hint: "_Dead ends, so they are not tried again._" },
  { heading: TASK_DOC_SECTIONS.unresolvedErrors, hint: "_Errors still outstanding, verbatim where it matters._" },
]

export function renderTaskDocSkeleton(): string {
  return [
    "# Task state",
    "",
    "_Durable state for this task. The repository, its tests and git remain the source of truth;",
    "this file records intent and history that they cannot._",
    "",
    ...SKELETON_SECTIONS.flatMap(({ heading, hint }) => [`## ${heading}`, "", hint, ""]),
  ].join("\n")
}
