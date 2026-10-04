import { VisibilityConditionStrictSchema, validateSpec, type VisibilityCondition } from "@json-render/core"
import { z } from "zod"
import { isJsonArray, isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../json"
import {
  GENUI_ACTIONS,
  GENUI_COMPONENTS,
  componentDef,
  isGenUIActionName,
  isGenUIComponentName,
  type GenUIActionName,
  type GenUIComponentName,
} from "./catalog"
import { datasetDeclSchema, type DatasetDecl } from "./datasets"
import { jsonByteLength, jsonObjectSchema, jsonValueSchema } from "./json-schema"

export const GENUI_PROTOCOL_VERSION = 1
export const GENUI_MAX_ELEMENTS = 200
export const GENUI_MAX_STATE_BYTES = 32 * 1024
export const GENUI_MAX_SOURCE_BYTES = 256 * 1024
export const GENUI_MAX_DATASETS = 12

const ELEMENT_KEY = /^[A-Za-z0-9_-]{1,64}$/
const statePointer = z.string().regex(/^\/[A-Za-z0-9_\-/]*$/)

export interface GenUIActionBinding {
  action: GenUIActionName
  params?: JsonObject
  preventDefault?: boolean
}

export interface GenUIElement {
  type: GenUIComponentName
  props: JsonObject
  children: string[]
  visible?: VisibilityCondition
  on?: Record<string, GenUIActionBinding[]>
  repeat?: { statePath: string; key?: string }
}

export interface GenUISpec {
  version: typeof GENUI_PROTOCOL_VERSION
  title?: string
  root: string
  elements: Record<string, GenUIElement>
  state?: JsonObject
  datasets?: Record<string, DatasetDecl>
}

export interface GenUIIssue {
  path: string
  message: string
}

export type GenUISpecParse = { ok: true; spec: GenUISpec } | { ok: false; issues: GenUIIssue[] }

const bindingSchema = z.strictObject({
  action: z.string().min(1).max(64),
  params: jsonObjectSchema.optional(),
  preventDefault: z.boolean().optional(),
})

const elementSchema = z.strictObject({
  type: z.string().min(1).max(64),
  props: jsonObjectSchema.optional(),
  children: z.array(z.string()).max(50).optional(),
  visible: jsonValueSchema.optional(),
  on: z.record(z.string().min(1).max(40), z.union([bindingSchema, z.array(bindingSchema).min(1).max(4)])).optional(),
  repeat: z.strictObject({ statePath: statePointer, key: z.string().min(1).max(64).optional() }).optional(),
})

const envelopeSchema = z.strictObject({
  version: z.literal(GENUI_PROTOCOL_VERSION),
  title: z.string().min(1).max(120).optional(),
  root: z.string().min(1),
  elements: z.record(z.string(), elementSchema),
  state: jsonObjectSchema.optional(),
  datasets: z.record(z.string(), jsonValueSchema).optional(),
})

type RawElement = z.output<typeof elementSchema>

const EXPRESSION_KEYS = new Set(["$state", "$bindState", "$template", "$item", "$index", "$cond", "$then", "$else"])

const expressionSchema = z.union([
  z.strictObject({ $state: statePointer }),
  z.strictObject({ $bindState: statePointer }),
  z.strictObject({ $template: z.string().max(2000) }),
  z.strictObject({ $item: z.string().max(200) }),
  z.strictObject({ $index: z.literal(true) }),
  z.strictObject({ $cond: jsonValueSchema, $then: jsonValueSchema, $else: jsonValueSchema }),
])

function pathOf(segments: readonly (string | number)[]): string {
  return segments.map(String).join(".")
}

function zodIssues(error: z.ZodError, prefix: readonly (string | number)[]): GenUIIssue[] {
  return error.issues.map((issue) => ({
    path: pathOf([...prefix, ...issue.path.filter((segment): segment is string | number => typeof segment !== "symbol")]),
    message: issue.message,
  }))
}

interface Substitution {
  value: JsonValue | undefined
  expressionPaths: string[]
  issues: GenUIIssue[]
}

function substituteExpressions(value: JsonValue, path: readonly (string | number)[]): Substitution {
  if (isJsonArray(value)) {
    const result: Substitution = { value: [], expressionPaths: [], issues: [] }
    const items: JsonValue[] = []
    value.forEach((item, index) => {
      const nested = substituteExpressions(item, [...path, index])
      items.push(nested.value ?? null)
      result.expressionPaths.push(...nested.expressionPaths)
      result.issues.push(...nested.issues)
    })
    return { ...result, value: items }
  }
  if (!isJsonObject(value)) return { value, expressionPaths: [], issues: [] }
  const dollarKeys = Object.keys(value).filter((key) => key.startsWith("$"))
  if (dollarKeys.length > 0) return checkExpression(value, dollarKeys, path)
  const entries: [string, JsonValue][] = []
  const result: Substitution = { value: undefined, expressionPaths: [], issues: [] }
  for (const [key, item] of Object.entries(value)) {
    const nested = substituteExpressions(item, [...path, key])
    if (nested.value !== undefined) entries.push([key, nested.value])
    result.expressionPaths.push(...nested.expressionPaths)
    result.issues.push(...nested.issues)
  }
  return { ...result, value: Object.fromEntries(entries) }
}

function checkExpression(value: JsonObject, dollarKeys: readonly string[], path: readonly (string | number)[]): Substitution {
  const at = pathOf(path)
  const unsupported = dollarKeys.find((key) => !EXPRESSION_KEYS.has(key))
  if (unsupported) {
    return {
      value: undefined,
      expressionPaths: [at],
      issues: [{ path: at, message: `unsupported expression ${unsupported}; use $state, $bindState, $template, $item, $index, or $cond` }],
    }
  }
  const parsed = expressionSchema.safeParse(value)
  if (!parsed.success) return { value: undefined, expressionPaths: [at], issues: [{ path: at, message: "malformed expression" }] }
  const issues: GenUIIssue[] = []
  if ("$cond" in parsed.data) {
    if (!VisibilityConditionStrictSchema.safeParse(parsed.data.$cond).success) issues.push({ path: `${at}.$cond`, message: "invalid condition" })
    issues.push(...substituteExpressions(parsed.data.$then, [...path, "$then"]).issues)
    issues.push(...substituteExpressions(parsed.data.$else, [...path, "$else"]).issues)
  }
  return { value: undefined, expressionPaths: [at], issues }
}

function coveredByExpression(issuePath: string, expressionPaths: readonly string[]): boolean {
  return expressionPaths.some((path) => issuePath === path || issuePath.startsWith(`${path}.`))
}

function validateWithExpressions(schema: z.ZodType<JsonObject>, value: JsonObject, prefix: readonly (string | number)[]): GenUIIssue[] {
  const substituted = substituteExpressions(value, prefix)
  const parsed = schema.safeParse(substituted.value ?? {})
  const schemaIssues = parsed.success ? [] : zodIssues(parsed.error, prefix)
  return [...substituted.issues, ...schemaIssues.filter((issue) => !coveredByExpression(issue.path, substituted.expressionPaths))]
}

function normalizeBindings(on: RawElement["on"]): Record<string, z.output<typeof bindingSchema>[]> {
  if (!on) return {}
  return Object.fromEntries(Object.entries(on).map(([event, binding]) => [event, Array.isArray(binding) ? binding : [binding]]))
}

function checkElement(key: string, raw: RawElement, datasets: Record<string, DatasetDecl>): { element: GenUIElement | null; issues: GenUIIssue[] } {
  const at = ["elements", key]
  if (!ELEMENT_KEY.test(key)) return { element: null, issues: [{ path: pathOf(at), message: "element keys use letters, digits, _ and - (at most 64)" }] }
  if (!isGenUIComponentName(raw.type)) {
    return { element: null, issues: [{ path: pathOf([...at, "type"]), message: `unknown component "${raw.type}"; available: ${Object.keys(GENUI_COMPONENTS).join(", ")}` }] }
  }
  const def = componentDef(raw.type)
  const props = raw.props ?? {}
  const issues = validateWithExpressions(def.props, props, [...at, "props"])
  const children = raw.children ?? []
  if (!def.children && children.length > 0) issues.push({ path: pathOf([...at, "children"]), message: `${raw.type} takes no children` })

  const bindings = normalizeBindings(raw.on)
  const on: Record<string, GenUIActionBinding[]> = {}
  for (const [event, list] of Object.entries(bindings)) {
    const allowed: readonly string[] = def.events
    if (!allowed.includes(event)) {
      issues.push({ path: pathOf([...at, "on", event]), message: `${raw.type} emits ${allowed.length > 0 ? allowed.join(", ") : "no events"}` })
      continue
    }
    const checked: GenUIActionBinding[] = []
    list.forEach((binding, index) => {
      const bindingPath = [...at, "on", event, index]
      if (!isGenUIActionName(binding.action)) {
        issues.push({ path: pathOf([...bindingPath, "action"]), message: `unknown action "${binding.action}"; available: ${Object.keys(GENUI_ACTIONS).join(", ")}` })
        return
      }
      issues.push(...validateWithExpressions(GENUI_ACTIONS[binding.action].params, binding.params ?? {}, [...bindingPath, "params"]))
      checked.push({ action: binding.action, ...(binding.params ? { params: binding.params } : {}), ...(binding.preventDefault ? { preventDefault: true } : {}) })
    })
    on[event] = checked
  }

  let visible: VisibilityCondition | undefined
  if (raw.visible !== undefined) {
    const parsed = VisibilityConditionStrictSchema.safeParse(raw.visible)
    if (parsed.success) visible = parsed.data
    else issues.push({ path: pathOf([...at, "visible"]), message: "invalid visibility condition" })
  }

  for (const ref of def.datasetRefs?.(props) ?? []) {
    issues.push(...checkDatasetReference(ref, datasets, [...at, "props"]))
  }

  return {
    element: {
      type: raw.type,
      props,
      children,
      ...(visible !== undefined ? { visible } : {}),
      ...(Object.keys(on).length > 0 ? { on } : {}),
      ...(raw.repeat ? { repeat: raw.repeat } : {}),
    },
    issues,
  }
}

function checkDatasetReference(
  ref: { dataset: string; metrics: readonly string[]; dimensions: readonly string[] },
  datasets: Record<string, DatasetDecl>,
  at: readonly (string | number)[],
): GenUIIssue[] {
  const decl = datasets[ref.dataset]
  if (!decl) {
    const known = Object.keys(datasets)
    return [{ path: pathOf([...at, "dataset"]), message: `unknown dataset "${ref.dataset}"; ${known.length > 0 ? `declared: ${known.join(", ")}` : "declare it under datasets"}` }]
  }
  const issues: GenUIIssue[] = []
  for (const metric of ref.metrics) {
    if (!decl.metrics[metric]) issues.push({ path: pathOf(at), message: `dataset "${ref.dataset}" has no metric "${metric}"` })
  }
  for (const dimension of ref.dimensions) {
    if (!decl.dimensions?.[dimension]) issues.push({ path: pathOf(at), message: `dataset "${ref.dataset}" has no dimension "${dimension}"` })
  }
  return issues
}

function parseDatasets(raw: Record<string, JsonValue> | undefined): { datasets: Record<string, DatasetDecl>; issues: GenUIIssue[] } {
  const datasets: Record<string, DatasetDecl> = {}
  const issues: GenUIIssue[] = []
  const entries = Object.entries(raw ?? {})
  if (entries.length > GENUI_MAX_DATASETS) issues.push({ path: "datasets", message: `declare at most ${GENUI_MAX_DATASETS} datasets` })
  for (const [id, value] of entries) {
    if (!ELEMENT_KEY.test(id)) {
      issues.push({ path: pathOf(["datasets", id]), message: "dataset ids use letters, digits, _ and -" })
      continue
    }
    const parsed = datasetDeclSchema.safeParse(value)
    if (parsed.success) datasets[id] = parsed.data
    else issues.push(...zodIssues(parsed.error, ["datasets", id]))
  }
  return { datasets, issues }
}

export function parseGenUISpec(input: string | JsonValue): GenUISpecParse {
  if (typeof input === "string" && new TextEncoder().encode(input).byteLength > GENUI_MAX_SOURCE_BYTES) {
    return { ok: false, issues: [{ path: "", message: `the spec exceeds ${GENUI_MAX_SOURCE_BYTES / 1024} KB; aggregate the inline data, or use a "file" or "mcp" dataset that reads it where it already lives` }] }
  }
  const value = typeof input === "string" ? safeJsonParse(input) : input
  if (value === null || !isJsonObject(value)) {
    return { ok: false, issues: [{ path: "", message: "the spec must be one JSON object" }] }
  }
  if (value.version !== GENUI_PROTOCOL_VERSION) {
    return { ok: false, issues: [{ path: "version", message: `unsupported protocol version ${JSON.stringify(value.version ?? null)}; this Kanna reads version ${GENUI_PROTOCOL_VERSION}` }] }
  }
  const envelope = envelopeSchema.safeParse(value)
  if (!envelope.success) return { ok: false, issues: zodIssues(envelope.error, []) }
  const raw = envelope.data

  const { datasets, issues } = parseDatasets(raw.datasets)
  const elementEntries = Object.entries(raw.elements)
  if (elementEntries.length === 0) issues.push({ path: "elements", message: "declare at least one element" })
  if (elementEntries.length > GENUI_MAX_ELEMENTS) issues.push({ path: "elements", message: `declare at most ${GENUI_MAX_ELEMENTS} elements` })
  if (raw.state && jsonByteLength(raw.state) > GENUI_MAX_STATE_BYTES) {
    issues.push({ path: "state", message: `state exceeds ${GENUI_MAX_STATE_BYTES / 1024} KB; state is for view settings, data belongs in datasets` })
  }

  const elements: Record<string, GenUIElement> = {}
  for (const [key, rawElement] of elementEntries) {
    const checked = checkElement(key, rawElement, datasets)
    issues.push(...checked.issues)
    if (checked.element) elements[key] = checked.element
  }

  const spec: GenUISpec = {
    version: GENUI_PROTOCOL_VERSION,
    ...(raw.title ? { title: raw.title } : {}),
    root: raw.root,
    elements,
    ...(raw.state ? { state: raw.state } : {}),
    ...(Object.keys(datasets).length > 0 ? { datasets } : {}),
  }

  if (issues.length === 0) {
    const structure = validateSpec({
      root: spec.root,
      elements: Object.fromEntries(Object.entries(elements).map(([key, element]) => [key, {
        type: element.type,
        props: element.props,
        children: element.children,
        ...(element.visible !== undefined ? { visible: element.visible } : {}),
        ...(element.repeat ? { repeat: element.repeat } : {}),
      }])),
      ...(spec.state ? { state: spec.state } : {}),
    })
    for (const issue of structure.issues) {
      if (issue.severity === "error") issues.push({ path: issue.elementKey ? `elements.${issue.elementKey}` : "", message: issue.message })
    }
  }

  return issues.length > 0 ? { ok: false, issues } : { ok: true, spec }
}

export const GENUI_ISSUE_REPORT_LIMIT = 20

export function formatGenUIIssues(issues: readonly GenUIIssue[]): string {
  const shown = issues.slice(0, GENUI_ISSUE_REPORT_LIMIT).map((issue) => `- ${issue.path || "(spec)"}: ${issue.message}`)
  const more = issues.length > GENUI_ISSUE_REPORT_LIMIT ? [`- …and ${issues.length - GENUI_ISSUE_REPORT_LIMIT} more`] : []
  return [...shown, ...more].join("\n")
}
