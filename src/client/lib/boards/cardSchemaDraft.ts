/**
 * The pure edits a board's card schema is built from.
 *
 * Separate from the panel for the reason `cardFieldValue.ts` is separate from
 * the drawer: these are the decisions worth pinning, and the component keeps
 * only the DOM. Every function takes the whole schema and returns a new one, so
 * a draft is one immutable value the store can swap.
 *
 * **A field's id is minted once and never touched again.** {@link CardContent}
 * is keyed by field id, so an id that moves takes every card's value for that
 * field with it — silently, since nothing reads the old key afterwards.
 * Renaming therefore changes `label` alone. The same rule holds for option ids
 * inside a `select` / `multiselect`.
 *
 * Removal does not rewrite card content either. The value stays where it is and
 * simply stops being rendered (`decode.ts` keeps an unreadable-by-schema value
 * readable on purpose), which makes re-adding a field with the same id restore
 * its old values.
 */

import { LOAD_BEARING_FIELD_NOTES } from "../../../shared/boards/cardSchema"
import { isColumnColorToken, type FieldDef, type FieldKind, type FieldOption } from "../../../shared/boards/types"

/** What each kind is called where a person picks one. */
export const FIELD_KIND_LABELS: Readonly<Record<FieldKind, string>> = {
  text: "Text",
  longtext: "Long text",
  url: "Link",
  number: "Number",
  date: "Date",
  select: "Single choice",
  multiselect: "Multiple choice",
  label: "Tags",
}

/** The kinds that carry an option list, and are the only ones an option edit reaches. */
export function hasOptions(kind: FieldKind): boolean {
  return kind === "select" || kind === "multiselect"
}

/**
 * An id derived from a label.
 *
 * camelCase rather than kebab so that typing the obvious label lands on the id
 * the rest of Kanna already reads: "Description" → `description`, "Acceptance
 * criteria" → `acceptanceCriteria`. See `shared/boards/cardSchema.ts` for why
 * hitting those exactly is worth the extra rule.
 */
export function slugFieldId(label: string): string {
  const words = label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word !== "")
  if (words.length === 0) return "field"
  return words
    .map((word, index) => (index === 0 ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("")
}

/** A field id that no field on the board holds yet. */
export function mintFieldId(label: string, fields: readonly FieldDef[]): string {
  return uniqueId(slugFieldId(label), new Set(fields.map((field) => field.id)))
}

/** An option id that no option on the same field holds yet. */
export function mintOptionId(label: string, options: readonly FieldOption[]): string {
  return uniqueId(slugFieldId(label), new Set(options.map((option) => option.id)))
}

export function addField(fields: readonly FieldDef[], label: string, kind: FieldKind): readonly FieldDef[] {
  const trimmed = label.trim()
  if (trimmed === "") return fields
  return [
    ...fields,
    {
      id: mintFieldId(trimmed, fields),
      label: trimmed,
      kind,
      options: hasOptions(kind) ? [] : null,
      required: false,
    },
  ]
}

export function renameField(fields: readonly FieldDef[], fieldId: string, label: string): readonly FieldDef[] {
  return mapField(fields, fieldId, (field) => ({ ...field, label }))
}

export function toggleRequired(fields: readonly FieldDef[], fieldId: string): readonly FieldDef[] {
  return mapField(fields, fieldId, (field) => ({ ...field, required: !field.required }))
}

export function removeField(fields: readonly FieldDef[], fieldId: string): readonly FieldDef[] {
  return fields.filter((field) => field.id !== fieldId)
}

/**
 * One step up or down. Array order IS render order in the drawer, so this is
 * the whole of reordering.
 *
 * Either end holds rather than wraps: a list that teleports its last row to the
 * top reads as a bug, and the buttons are disabled there anyway.
 */
export function moveField(fields: readonly FieldDef[], fieldId: string, delta: number): readonly FieldDef[] {
  const from = fields.findIndex((field) => field.id === fieldId)
  const to = from + delta
  if (from === -1 || to < 0 || to >= fields.length) return fields
  const next = [...fields]
  const moved = next[from]
  const displaced = next[to]
  if (!moved || !displaced) return fields
  next[to] = moved
  next[from] = displaced
  return next
}

export function addOption(fields: readonly FieldDef[], fieldId: string, label: string): readonly FieldDef[] {
  const trimmed = label.trim()
  if (trimmed === "") return fields
  return mapOptions(fields, fieldId, (options) => [
    ...options,
    { id: mintOptionId(trimmed, options), label: trimmed, colorToken: null },
  ])
}

export function renameOption(
  fields: readonly FieldDef[],
  fieldId: string,
  optionId: string,
  label: string,
): readonly FieldDef[] {
  return mapOptions(fields, fieldId, (options) =>
    options.map((option) => (option.id === optionId ? { ...option, label } : option)),
  )
}

export function removeOption(
  fields: readonly FieldDef[],
  fieldId: string,
  optionId: string,
): readonly FieldDef[] {
  return mapOptions(fields, fieldId, (options) => options.filter((option) => option.id !== optionId))
}

/**
 * The colour is narrowed here rather than at the call site: the palette is a
 * closed set of design tokens, and anything outside it clears the dot instead
 * of putting an un-themeable value in the database.
 */
export function setOptionColor(
  fields: readonly FieldDef[],
  fieldId: string,
  optionId: string,
  raw: string,
): readonly FieldDef[] {
  const colorToken = isColumnColorToken(raw) ? raw : null
  return mapOptions(fields, fieldId, (options) =>
    options.map((option) => (option.id === optionId ? { ...option, colorToken } : option)),
  )
}

/**
 * The ids other features read that this board has not declared.
 *
 * Never creating one of these degrades sync and Start work exactly as much as
 * removing it does, and that case has no moment to warn at — so the editor
 * names them while they are absent, not only while one is being deleted.
 */
export function missingLoadBearingIds(fields: readonly FieldDef[]): string[] {
  const declared = new Set(fields.map((field) => field.id))
  return Object.keys(LOAD_BEARING_FIELD_NOTES).filter((fieldId) => !declared.has(fieldId))
}

function uniqueId(base: string, taken: ReadonlySet<string>): string {
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}${String(suffix)}`)) suffix += 1
  return `${base}${String(suffix)}`
}

function mapField(
  fields: readonly FieldDef[],
  fieldId: string,
  edit: (field: FieldDef) => FieldDef,
): readonly FieldDef[] {
  return fields.map((field) => (field.id === fieldId ? edit(field) : field))
}

/** A field with no option list is left alone; only `select` / `multiselect` have one. */
function mapOptions(
  fields: readonly FieldDef[],
  fieldId: string,
  edit: (options: readonly FieldOption[]) => FieldOption[],
): readonly FieldDef[] {
  return mapField(fields, fieldId, (field) =>
    field.options === null ? field : { ...field, options: edit(field.options) },
  )
}
