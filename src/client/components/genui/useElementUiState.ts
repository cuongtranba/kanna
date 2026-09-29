import { useCallback } from "react"
import { useStateStore, useStateValue, type ComponentRenderProps } from "@json-render/react"
import type { JsonValue } from "../../../shared/json"

export const ELEMENT_KEY_PROP = "_kannaKey"
export const UI_STATE_ROOT = "/_ui"

export function elementKeyOf(element: ComponentRenderProps["element"]): string {
  const key = element.props[ELEMENT_KEY_PROP]
  return typeof key === "string" ? key : element.type
}

export function useElementUiState<T extends JsonValue>(
  element: ComponentRenderProps["element"],
  name: string,
  initial: T,
  isValue: (value: JsonValue | undefined) => value is T,
): [T, (next: T) => void] {
  const path = `${UI_STATE_ROOT}/${elementKeyOf(element)}/${name}`
  const stored = useStateValue<JsonValue>(path)
  const { set } = useStateStore()
  const update = useCallback((next: T) => set(path, next), [path, set])
  return [isValue(stored) ? stored : initial, update]
}

export function isString(value: JsonValue | undefined): value is string {
  return typeof value === "string"
}

export function isBoolean(value: JsonValue | undefined): value is boolean {
  return typeof value === "boolean"
}

export function isStringList(value: JsonValue | undefined): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
}
