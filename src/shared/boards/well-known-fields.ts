import type { CardContent, FieldValue } from "./types"

export const WELL_KNOWN_FIELDS = ["description", "labels", "assignee", "acceptanceCriteria", "externalUrl"] as const

export type WellKnownField = (typeof WELL_KNOWN_FIELDS)[number]

export const GITHUB_MIRRORED_FIELDS: readonly WellKnownField[] = ["labels", "assignee"]

export function isGithubMirroredField(fieldId: string): boolean {
  return GITHUB_MIRRORED_FIELDS.some((mirrored) => mirrored === fieldId)
}

export const WELL_KNOWN_FIELD_NOTES: Readonly<Record<WellKnownField, string>> = {
  description:
    "GitHub sync writes issue bodies here, and Start work puts it in the agent's first prompt.",
  labels: "GitHub sync writes issue labels here, and Start work puts them in the agent's first prompt.",
  assignee: "GitHub sync writes the issue's assignee here.",
  acceptanceCriteria: "Start work puts this in the agent's first prompt.",
  externalUrl:
    "GitHub sync writes the issue's link here, and Start work puts it in the agent's first prompt.",
}

function isWellKnownField(fieldId: string): fieldId is WellKnownField {
  return WELL_KNOWN_FIELDS.some((known) => known === fieldId)
}

export function loadBearingFieldNote(fieldId: string): string | null {
  return isWellKnownField(fieldId) ? WELL_KNOWN_FIELD_NOTES[fieldId] : null
}

function textOf(value: FieldValue | undefined): string | null {
  if (!value) return null
  if (value.kind === "text" || value.kind === "longtext" || value.kind === "url") return value.value
  return null
}

export function cardText(content: CardContent, field: WellKnownField): string | null {
  return textOf(content[field])
}

export function cardLabels(content: CardContent): readonly string[] {
  const value = content.labels
  return value?.kind === "label" ? value.values : []
}
