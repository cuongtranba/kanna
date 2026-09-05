
import { LOAD_BEARING_FIELD_NOTES } from "../../../shared/boards/cardSchema"
import { isColumnColorToken, type FieldDef, type FieldKind, type FieldOption } from "../../../shared/boards/types"

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

export function hasOptions(kind: FieldKind): boolean {
  return kind === "select" || kind === "multiselect"
}

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

export function mintFieldId(label: string, fields: readonly FieldDef[]): string {
  return uniqueId(slugFieldId(label), new Set(fields.map((field) => field.id)))
}

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

function mapOptions(
  fields: readonly FieldDef[],
  fieldId: string,
  edit: (options: readonly FieldOption[]) => FieldOption[],
): readonly FieldDef[] {
  return mapField(fields, fieldId, (field) =>
    field.options === null ? field : { ...field, options: edit(field.options) },
  )
}
