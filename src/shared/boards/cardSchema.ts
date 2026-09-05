export const LOAD_BEARING_FIELD_NOTES: Readonly<Record<string, string>> = {
  description:
    "GitHub sync writes issue bodies here, and Start work puts it in the agent's first prompt.",
  labels: "GitHub sync writes issue labels here, and Start work puts them in the agent's first prompt.",
  assignee: "GitHub sync writes the issue's assignee here.",
  acceptanceCriteria: "Start work puts this in the agent's first prompt.",
  externalUrl:
    "GitHub sync writes the issue's link here, and Start work puts it in the agent's first prompt.",
}

export function loadBearingFieldNote(fieldId: string): string | null {
  return LOAD_BEARING_FIELD_NOTES[fieldId] ?? null
}
