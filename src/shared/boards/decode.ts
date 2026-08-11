/**
 * Decoders for board values that arrive as JSON.
 *
 * SQLite stores card content, actors, field schemas, and template definitions
 * as JSON text. That text is a BOUNDARY — it can be stale (written by an older
 * build), hand-edited, or corrupt — so it is validated on the way in rather
 * than asserted into shape. Every decoder returns `null` on anything it does
 * not recognise, and the collection decoders drop unrecognised entries instead
 * of failing the whole row: one malformed label must not make a card
 * unreadable.
 *
 * Pure, no IO. The adapter calls these; it does no shape-checking of its own,
 * which keeps it the leaf module the side-effect seal expects.
 */

import { isRecord, type AnyValue } from "../errors"
import {
  isColumnColorToken,
  isColumnSemantic,
  isFieldKind,
  isRemoteKind,
  type BoardTemplateColumn,
  type BoardTemplateDefinition,
  type BoardTemplateMapping,
  type CardActor,
  type CardContent,
  type FieldDef,
  type FieldOption,
  type FieldValue,
} from "./types"

function decodeStringArray(value: AnyValue): string[] {
  if (!Array.isArray(value)) return []
  const values: string[] = []
  for (const entry of value) {
    if (typeof entry === "string") values.push(entry)
  }
  return values
}

function decodeOptionalString(value: AnyValue): string | null {
  return typeof value === "string" ? value : null
}

function decodeOptionalNumber(value: AnyValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}

// ── Field schema ──────────────────────────────────────────────────────────────

export function decodeFieldOption(value: AnyValue): FieldOption | null {
  if (!isRecord(value)) return null
  const { id, label } = value
  if (typeof id !== "string" || typeof label !== "string") return null
  const colorToken = typeof value.colorToken === "string" && isColumnColorToken(value.colorToken)
    ? value.colorToken
    : null
  return { id, label, colorToken }
}

export function decodeFieldDef(value: AnyValue): FieldDef | null {
  if (!isRecord(value)) return null
  const { id, label, kind } = value
  if (typeof id !== "string" || typeof label !== "string") return null
  if (typeof kind !== "string" || !isFieldKind(kind)) return null

  let options: FieldOption[] | null = null
  if (Array.isArray(value.options)) {
    options = []
    for (const entry of value.options) {
      const option = decodeFieldOption(entry)
      if (option) options.push(option)
    }
  }
  return { id, label, kind, options, required: value.required === true }
}

export function decodeFieldDefs(value: AnyValue): FieldDef[] {
  if (!Array.isArray(value)) return []
  const fields: FieldDef[] = []
  for (const entry of value) {
    const field = decodeFieldDef(entry)
    if (field) fields.push(field)
  }
  return fields
}

// ── Card content ──────────────────────────────────────────────────────────────

export function decodeFieldValue(value: AnyValue): FieldValue | null {
  if (!isRecord(value)) return null
  const kind = value.kind
  if (typeof kind !== "string") return null

  switch (kind) {
    case "text":
      return typeof value.value === "string" ? { kind: "text", value: value.value } : null
    case "longtext":
      return typeof value.value === "string" ? { kind: "longtext", value: value.value } : null
    case "url":
      return typeof value.value === "string" ? { kind: "url", value: value.value } : null
    case "number":
      return typeof value.value === "number" && Number.isFinite(value.value)
        ? { kind: "number", value: value.value }
        : null
    case "date":
      return typeof value.value === "number" && Number.isInteger(value.value)
        ? { kind: "date", value: value.value }
        : null
    case "select": {
      if (value.optionId === null) return { kind: "select", optionId: null }
      return typeof value.optionId === "string" ? { kind: "select", optionId: value.optionId } : null
    }
    case "multiselect":
      return { kind: "multiselect", optionIds: decodeStringArray(value.optionIds) }
    case "label":
      return { kind: "label", values: decodeStringArray(value.values) }
    default:
      return null
  }
}

export function decodeCardContent(value: AnyValue): CardContent {
  if (!isRecord(value)) return {}
  const content: Record<string, FieldValue> = {}
  for (const [fieldId, raw] of Object.entries(value)) {
    const decoded = decodeFieldValue(raw)
    if (decoded) content[fieldId] = decoded
  }
  return content
}

// ── Actors ────────────────────────────────────────────────────────────────────

/**
 * Falls back to `{kind:"user"}` rather than null: an unreadable actor must not
 * make a card unreadable, and "a person did it" is the conservative default —
 * it never grants an agent-origin write the push it would otherwise be held for.
 */
export function decodeActor(value: AnyValue): CardActor {
  if (!isRecord(value)) return { kind: "user" }
  if (value.kind === "agent" && typeof value.chatId === "string") {
    return { kind: "agent", chatId: value.chatId }
  }
  if (value.kind === "sync" && typeof value.providerId === "string") {
    return { kind: "sync", providerId: value.providerId }
  }
  return { kind: "user" }
}

// ── Templates ─────────────────────────────────────────────────────────────────

export function decodeTemplateColumn(value: AnyValue): BoardTemplateColumn | null {
  if (!isRecord(value)) return null
  const { title } = value
  if (typeof title !== "string") return null
  const semantic = typeof value.semantic === "string" && isColumnSemantic(value.semantic) ? value.semantic : null
  const colorToken = typeof value.colorToken === "string" && isColumnColorToken(value.colorToken)
    ? value.colorToken
    : null
  return { title, semantic, colorToken, wipLimit: decodeOptionalNumber(value.wipLimit) }
}

export function decodeTemplateMapping(value: AnyValue): BoardTemplateMapping | null {
  if (!isRecord(value)) return null
  const { columnTitle, remoteKind, remoteValue } = value
  if (typeof columnTitle !== "string" || typeof remoteValue !== "string") return null
  if (typeof remoteKind !== "string" || !isRemoteKind(remoteKind)) return null
  return { columnTitle, remoteKind, remoteValue }
}

export function decodeTemplateDefinition(value: AnyValue): BoardTemplateDefinition {
  if (!isRecord(value)) return { columns: [], cardFields: [], mappingDefaults: [] }

  const columns: BoardTemplateColumn[] = []
  if (Array.isArray(value.columns)) {
    for (const entry of value.columns) {
      const column = decodeTemplateColumn(entry)
      if (column) columns.push(column)
    }
  }

  const mappingDefaults: BoardTemplateMapping[] = []
  if (Array.isArray(value.mappingDefaults)) {
    for (const entry of value.mappingDefaults) {
      const mapping = decodeTemplateMapping(entry)
      if (mapping) mappingDefaults.push(mapping)
    }
  }

  return { columns, cardFields: decodeFieldDefs(value.cardFields), mappingDefaults }
}

// ── Misc ──────────────────────────────────────────────────────────────────────

export { decodeOptionalString, decodeOptionalNumber, decodeStringArray }
