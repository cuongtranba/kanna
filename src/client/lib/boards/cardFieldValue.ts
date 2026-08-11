/**
 * A card field's value, in the three forms the drawer needs it in: the text it
 * is edited as, the text it reads as at rest, and the {@link FieldValue} that
 * goes back to the server.
 *
 * Pure and separate from the drawer because these are the decisions worth
 * pinning — what an empty draft means, which option ids a board still offers,
 * and that a commit carries the fields it did not touch. The component keeps
 * only the DOM.
 */

import type { CardContent, FieldDef, FieldOption, FieldValue } from "../../../shared/boards/types"

const NO_OPTIONS: readonly FieldOption[] = []

export function optionsOf(field: FieldDef): readonly FieldOption[] {
  return field.options ?? NO_OPTIONS
}

/** The option a `select` holds, or null — including when the value is not one. */
export function selectedOptionId(value: FieldValue | undefined): string | null {
  return value?.kind === "select" ? value.optionId : null
}

/** The options a `multiselect` holds; empty for anything else. */
export function selectedOptionIds(value: FieldValue | undefined): readonly string[] {
  return value?.kind === "multiselect" ? value.optionIds : NO_STRINGS
}

const NO_STRINGS: readonly string[] = []

/** The selection after one chip is pressed. */
export function toggledOptionIds(value: FieldValue | undefined, optionId: string): string[] {
  const held = selectedOptionIds(value)
  return held.includes(optionId) ? held.filter((entry) => entry !== optionId) : [...held, optionId]
}

/**
 * The text a field is edited as.
 *
 * A value whose kind no longer matches its definition reads as unset rather
 * than throwing: a board's schema can change under content already written, and
 * the drawer is where that is repaired, not where it becomes fatal.
 */
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

/**
 * What a typed draft means, or null when it clears the field.
 *
 * An emptied field is REMOVED rather than stored as an empty string, so a
 * required field that has been cleared reads as unanswered again.
 */
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
      // Read as UTC midnight, matching what `FieldValue` documents epoch
      // milliseconds to be — a local-time parse would shift the date it round-trips.
      const value = Date.parse(`${text}T00:00:00.000Z`)
      return Number.isFinite(value) ? { kind: "date", value } : null
    }
    case "select":
      // The server refuses an option the board does not offer, so proposing one
      // here would only be a round-trip to the same refusal.
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

/** How a value reads when nobody is editing it. */
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

/**
 * The card's whole content after one field changed.
 *
 * Whole, not a delta: `board.card.update` replaces a card's content, so a patch
 * carrying only the edited field would erase every other one.
 */
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

/** `YYYY-MM-DD`, the form an `<input type="date">` speaks. */
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
