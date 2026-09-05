
import type { CardContent, FieldDef, FieldOption, FieldValue } from "../../../shared/boards/types"

const NO_OPTIONS: readonly FieldOption[] = []

export function optionsOf(field: FieldDef): readonly FieldOption[] {
  return field.options ?? NO_OPTIONS
}

export function selectedOptionId(value: FieldValue | undefined): string | null {
  return value?.kind === "select" ? value.optionId : null
}

export function selectedOptionIds(value: FieldValue | undefined): readonly string[] {
  return value?.kind === "multiselect" ? value.optionIds : NO_STRINGS
}

const NO_STRINGS: readonly string[] = []

export function toggledOptionIds(value: FieldValue | undefined, optionId: string): string[] {
  const held = selectedOptionIds(value)
  return held.includes(optionId) ? held.filter((entry) => entry !== optionId) : [...held, optionId]
}

export function fieldDraftText(field: FieldDef, value: FieldValue | undefined): string {
  if (!value || value.kind !== field.kind) return ""
  switch (value.kind) {
    case "text":
    case "longtext":
    case "url":
      return value.value
    case "number":
      return String(value.value)
    case "date":
      return dateInputText(value.value)
    case "select":
      return value.optionId ?? ""
    case "multiselect":
      return value.optionIds.join(", ")
    case "label":
      return value.values.join(", ")
  }
}

export function parseFieldDraft(field: FieldDef, draft: string): FieldValue | null {
  const text = draft.trim()
  if (text === "") return null

  switch (field.kind) {
    case "text":
      return { kind: "text", value: text }
    case "longtext":
      return { kind: "longtext", value: text }
    case "url":
      return { kind: "url", value: text }
    case "number": {
      const value = Number(text)
      return Number.isFinite(value) ? { kind: "number", value } : null
    }
    case "date": {
      const value = Date.parse(`${text}T00:00:00.000Z`)
      return Number.isFinite(value) ? { kind: "date", value } : null
    }
    case "select":
      return offers(field, text) ? { kind: "select", optionId: text } : null
    case "multiselect": {
      const optionIds = splitList(text).filter((optionId) => offers(field, optionId))
      return optionIds.length === 0 ? null : { kind: "multiselect", optionIds }
    }
    case "label": {
      const values = splitList(text)
      return values.length === 0 ? null : { kind: "label", values }
    }
  }
}

export function fieldDisplayText(field: FieldDef, value: FieldValue | undefined): string {
  if (field.kind === "select") {
    const optionId = selectedOptionId(value)
    return optionId === null ? "" : (labelOf(field, optionId) ?? "")
  }
  if (field.kind === "multiselect") {
    return selectedOptionIds(value)
      .map((optionId) => labelOf(field, optionId))
      .filter((label) => label !== null)
      .join(", ")
  }
  return fieldDraftText(field, value)
}

export function nextCardContent(
  content: CardContent,
  fieldId: string,
  value: FieldValue | null,
): CardContent {
  const next: Record<string, FieldValue> = { ...content }
  if (value === null) delete next[fieldId]
  else next[fieldId] = value
  return next
}

export function dateInputText(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10)
}

function labelOf(field: FieldDef, optionId: string): string | null {
  return optionsOf(field).find((option) => option.id === optionId)?.label ?? null
}

function offers(field: FieldDef, optionId: string): boolean {
  return optionsOf(field).some((option) => option.id === optionId)
}

function splitList(text: string): string[] {
  return text
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
}
