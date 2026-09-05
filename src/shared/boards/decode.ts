
import { isJsonObject, type JsonValue } from "../json"
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

function decodeStringArray(value: JsonValue): string[] {
  if (!Array.isArray(value)) return []
  const values: string[] = []
  for (const entry of value) {
    if (typeof entry === "string") values.push(entry)
  }
  return values
}

function decodeOptionalString(value: JsonValue): string | null {
  return typeof value === "string" ? value : null
}

function decodeOptionalNumber(value: JsonValue): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null
}


export function decodeFieldOption(value: JsonValue): FieldOption | null {
  if (!isJsonObject(value)) return null
  const { id, label } = value
  if (typeof id !== "string" || typeof label !== "string") return null
  const colorToken = typeof value.colorToken === "string" && isColumnColorToken(value.colorToken)
    ? value.colorToken
    : null
  return { id, label, colorToken }
}

export function decodeFieldDef(value: JsonValue): FieldDef | null {
  if (!isJsonObject(value)) return null
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

export function decodeFieldDefs(value: JsonValue): FieldDef[] {
  if (!Array.isArray(value)) return []
  const fields: FieldDef[] = []
  for (const entry of value) {
    const field = decodeFieldDef(entry)
    if (field) fields.push(field)
  }
  return fields
}


export function decodeFieldDefsForWrite(value: JsonValue): FieldDef[] | null {
  if (!Array.isArray(value)) return null
  const fields: FieldDef[] = []
  const ids = new Set<string>()
  for (const entry of value) {
    const field = decodeFieldDefForWrite(entry)
    if (!field || ids.has(field.id)) return null
    ids.add(field.id)
    fields.push(field)
  }
  return fields
}

function decodeFieldDefForWrite(value: JsonValue): FieldDef | null {
  if (!isJsonObject(value)) return null
  const { id, label, kind } = value
  if (typeof id !== "string" || id === "") return null
  if (typeof label !== "string" || label.trim() === "") return null
  if (typeof kind !== "string" || !isFieldKind(kind)) return null
  if (value.required !== undefined && typeof value.required !== "boolean") return null

  const wantsOptions = kind === "select" || kind === "multiselect"
  if (!wantsOptions) {
    if (value.options !== undefined && value.options !== null) return null
    return { id, label, kind, options: null, required: value.required === true }
  }
  if (!Array.isArray(value.options)) return null

  const options: FieldOption[] = []
  const optionIds = new Set<string>()
  for (const entry of value.options) {
    const option = decodeFieldOptionForWrite(entry)
    if (!option || optionIds.has(option.id)) return null
    optionIds.add(option.id)
    options.push(option)
  }
  return { id, label, kind, options, required: value.required === true }
}

function decodeFieldOptionForWrite(value: JsonValue): FieldOption | null {
  if (!isJsonObject(value)) return null
  const { id, label } = value
  if (typeof id !== "string" || id === "") return null
  if (typeof label !== "string" || label.trim() === "") return null
  if (value.colorToken === undefined || value.colorToken === null) return { id, label, colorToken: null }
  if (typeof value.colorToken !== "string" || !isColumnColorToken(value.colorToken)) return null
  return { id, label, colorToken: value.colorToken }
}


export function decodeFieldValue(value: JsonValue): FieldValue | null {
  if (!isJsonObject(value)) return null
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

export function decodeCardContent(value: JsonValue): CardContent {
  if (!isJsonObject(value)) return {}
  const content: Record<string, FieldValue> = {}
  for (const [fieldId, raw] of Object.entries(value)) {
    const decoded = decodeFieldValue(raw)
    if (decoded) content[fieldId] = decoded
  }
  return content
}


export function decodeContentForFields(
  fields: readonly FieldDef[],
  value: JsonValue,
): CardContent | null {
  if (!isJsonObject(value)) return null
  const byId = new Map(fields.map((field) => [field.id, field]))
  const content: Record<string, FieldValue> = {}
  for (const [fieldId, raw] of Object.entries(value)) {
    const field = byId.get(fieldId)
    if (!field) return null
    const decoded = decodeValueForField(field, raw)
    if (!decoded) return null
    content[fieldId] = decoded
  }
  return content
}

export function decodeValueForField(field: FieldDef, value: JsonValue): FieldValue | null {
  if (!isJsonObject(value)) return null
  if (value.kind !== field.kind) return null

  switch (field.kind) {
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
      if (typeof value.optionId !== "string") return null
      return offersOption(field, value.optionId) ? { kind: "select", optionId: value.optionId } : null
    }
    case "multiselect": {
      const optionIds = decodeStrictStringArray(value.optionIds)
      if (!optionIds) return null
      return optionIds.every((optionId) => offersOption(field, optionId))
        ? { kind: "multiselect", optionIds }
        : null
    }
    case "label": {
      const values = decodeStrictStringArray(value.values)
      return values ? { kind: "label", values } : null
    }
  }
}

function offersOption(field: FieldDef, optionId: string): boolean {
  return (field.options ?? []).some((option) => option.id === optionId)
}

function decodeStrictStringArray(value: JsonValue): string[] | null {
  if (!Array.isArray(value)) return null
  const values: string[] = []
  for (const entry of value) {
    if (typeof entry !== "string") return null
    values.push(entry)
  }
  return values
}


export function decodeActor(value: JsonValue): CardActor {
  if (!isJsonObject(value)) return { kind: "user" }
  if (value.kind === "agent" && typeof value.chatId === "string") {
    return { kind: "agent", chatId: value.chatId }
  }
  if (value.kind === "sync" && typeof value.providerId === "string") {
    return { kind: "sync", providerId: value.providerId }
  }
  return { kind: "user" }
}


export function decodeTemplateColumn(value: JsonValue): BoardTemplateColumn | null {
  if (!isJsonObject(value)) return null
  const { title } = value
  if (typeof title !== "string") return null
  const semantic = typeof value.semantic === "string" && isColumnSemantic(value.semantic) ? value.semantic : null
  const colorToken = typeof value.colorToken === "string" && isColumnColorToken(value.colorToken)
    ? value.colorToken
    : null
  return { title, semantic, colorToken, wipLimit: decodeOptionalNumber(value.wipLimit) }
}

export function decodeTemplateMapping(value: JsonValue): BoardTemplateMapping | null {
  if (!isJsonObject(value)) return null
  const { columnTitle, remoteKind, remoteValue } = value
  if (typeof columnTitle !== "string" || typeof remoteValue !== "string") return null
  if (typeof remoteKind !== "string" || !isRemoteKind(remoteKind)) return null
  return { columnTitle, remoteKind, remoteValue }
}

export function decodeTemplateDefinition(value: JsonValue): BoardTemplateDefinition {
  if (!isJsonObject(value)) return { columns: [], cardFields: [], mappingDefaults: [] }

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


export { decodeOptionalString, decodeOptionalNumber, decodeStringArray }
