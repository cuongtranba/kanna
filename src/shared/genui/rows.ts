import { isJsonArray, isJsonObject, type JsonObject, type JsonValue } from "../json"

export const DATASET_MAX_ROWS = 200_000

export type RowsParse = { ok: true; rows: JsonObject[] } | { ok: false; message: string }

const AUTO_ROW_KEYS = ["rows", "data", "items", "results", "records", "values"] as const

function at(value: JsonValue, path: string): JsonValue | undefined {
  let current: JsonValue | undefined = value
  for (const segment of path.split(".")) {
    if (current === undefined) return undefined
    if (isJsonArray(current)) {
      const index = Number(segment)
      current = Number.isInteger(index) ? current[index] : undefined
    } else if (isJsonObject(current)) {
      current = current[segment]
    } else {
      return undefined
    }
  }
  return current
}

function columnNames(value: JsonValue | undefined): string[] | null {
  if (!value || !isJsonArray(value)) return null
  const names = value.map((column) => {
    if (typeof column === "string") return column
    if (isJsonObject(column) && typeof column.name === "string") return column.name
    return null
  })
  return names.every((name): name is string => name !== null) ? names : null
}

function zipRows(columns: readonly string[], rows: readonly JsonValue[]): JsonObject[] | null {
  const zipped: JsonObject[] = []
  for (const row of rows) {
    if (!isJsonArray(row)) return null
    zipped.push(Object.fromEntries(columns.map((column, index) => [column, row[index] ?? null])))
  }
  return zipped
}

function tableFrom(value: JsonValue): JsonObject[] | null {
  if (isJsonArray(value)) {
    if (value.every(isJsonObjectValue)) return value.filter(isJsonObjectValue)
    const [header, ...rest] = value
    const columns = columnNames(header ?? null)
    return columns ? zipRows(columns, rest) : null
  }
  if (!isJsonObject(value)) return null
  const columns = columnNames(value.columns)
  const rows = value.rows
  if (columns && rows && isJsonArray(rows)) {
    return rows.every(isJsonObjectValue) ? rows.filter(isJsonObjectValue) : zipRows(columns, rows)
  }
  return null
}

function isJsonObjectValue(value: JsonValue): value is JsonObject {
  return isJsonObject(value)
}

export function rowsFromJson(value: JsonValue, rowsPath?: string): RowsParse {
  const target = rowsPath ? at(value, rowsPath) : value
  if (target === undefined) return { ok: false, message: `rowsPath "${rowsPath}" does not exist in the data` }
  const direct = tableFrom(target)
  if (direct) return capped(direct)
  if (!rowsPath && isJsonObject(target)) {
    for (const key of AUTO_ROW_KEYS) {
      const nested = target[key]
      const table = nested === undefined ? null : tableFrom(nested)
      if (table) return capped(table)
    }
  }
  return { ok: false, message: "the data is not a table: expected an array of objects, {columns, rows}, or an object holding one (set rowsPath)" }
}

function capped(rows: JsonObject[]): RowsParse {
  if (rows.length > DATASET_MAX_ROWS) return { ok: false, message: `the data has ${rows.length} rows; the limit is ${DATASET_MAX_ROWS} — aggregate it first` }
  return { ok: true, rows }
}

export function rowsFromCsv(text: string): RowsParse {
  const records = parseCsvRecords(text.startsWith("﻿") ? text.slice(1) : text)
  const [header, ...body] = records
  if (!header || header.length === 0 || header.every((cell) => cell.trim() === "")) {
    return { ok: false, message: "the CSV has no header row" }
  }
  const columns = header.map((cell, index) => cell.trim() || `column_${index + 1}`)
  const rows = body
    .filter((record) => !(record.length === 1 && record[0] === ""))
    .map((record) => Object.fromEntries(columns.map((column, index) => [column, record[index] ?? ""])))
  return capped(rows)
}

function parseCsvRecords(text: string): string[][] {
  const records: string[][] = []
  let record: string[] = []
  let field = ""
  let quoted = false
  for (let index = 0; index < text.length; index++) {
    const char = text[index]
    if (quoted) {
      if (char === "\"" && text[index + 1] === "\"") {
        field += "\""
        index++
      } else if (char === "\"") {
        quoted = false
      } else {
        field += char
      }
      continue
    }
    if (char === "\"" && field === "") {
      quoted = true
    } else if (char === ",") {
      record.push(field)
      field = ""
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index++
      record.push(field)
      records.push(record)
      record = []
      field = ""
    } else {
      field += char
    }
  }
  if (field !== "" || record.length > 0) {
    record.push(field)
    records.push(record)
  }
  return records
}

export function rowsFromText(text: string, format: "csv" | "json", rowsPath?: string): RowsParse {
  if (format === "csv") return rowsFromCsv(text)
  try {
    const parsed: JsonValue = JSON.parse(text)
    return rowsFromJson(parsed, rowsPath)
  } catch {
    return { ok: false, message: "the file is not valid JSON" }
  }
}

export function formatForPath(path: string, declared?: "csv" | "json"): "csv" | "json" {
  if (declared) return declared
  return path.toLowerCase().endsWith(".csv") ? "csv" : "json"
}
