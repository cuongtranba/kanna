import { celEnv, isCelError, parse, plan, type CelResult } from "@bufbuild/cel"
import { isAlias, parseDocument, visit } from "yaml"
import { z } from "zod"
import { toError } from "../../shared/errors"
import { resolveJsonPath, type JsonValue } from "../../shared/json"
import { WEBHOOK_FILTER_MAX_CHARS } from "../../shared/webhooks/types"

export interface WebhookFilterInput {
  body: JsonValue
  headers: Headers
}

export type WebhookFilterVerdict = { matched: true } | { matched: false; reason: string }

export interface WebhookFilter {
  match(input: WebhookFilterInput): WebhookFilterVerdict
}

export type WebhookFilterCompilation =
  | { ok: true; filter: WebhookFilter }
  | { ok: false; errors: string[] }

const HIDDEN_HEADERS: ReadonlySet<string> = new Set([
  "authorization",
  "cookie",
  "x-hub-signature",
  "x-hub-signature-256",
])

const EVENT_HEADER = "x-github-event"
const UNRESOLVED_ATTRIBUTE = "unresolved attribute"

const filterSchema = z
  .object({
    on: z
      .union([
        z.string().min(1),
        z.array(z.string().min(1)).min(1),
        z
          .record(z.string(), z.union([z.null(), z.object({ types: z.array(z.string()).min(1).optional() }).strict()]))
          .refine((events) => Object.keys(events).length > 0, "must name at least one event"),
      ])
      .optional(),
    if: z.string().optional(),
  })
  .strict()

type EventTypes = ReadonlyMap<string, readonly string[] | null>
type Evaluate = (context: { body: JsonValue; event: string; headers: Record<string, string> }) => CelResult

function normalizeOn(on: string | string[] | Record<string, { types?: string[] } | null>): EventTypes {
  if (typeof on === "string") return new Map([[on, null]])
  if (Array.isArray(on)) return new Map(on.map((event) => [event, null]))
  return new Map(Object.entries(on).map(([event, spec]) => [event, spec?.types ?? null]))
}

function projectHeaders(headers: Headers): Record<string, string> {
  const projected: Record<string, string> = {}
  headers.forEach((value, name) => {
    const key = name.toLowerCase()
    if (!HIDDEN_HEADERS.has(key)) projected[key] = value
  })
  return projected
}

function describeIssue(issue: z.core.$ZodIssue): string {
  const path = issue.path.map(String).join(".")
  return path.length > 0 ? `${path}: ${issue.message}` : issue.message
}

function parseYaml(source: string): { ok: true; value: object | null } | { ok: false; error: string } {
  const doc = parseDocument(source, { uniqueKeys: true })
  const firstError = doc.errors[0]
  if (firstError) return { ok: false, error: firstError.message.split("\n")[0] }
  let reusesNodes = false
  visit(doc, {
    Node: (_key, node) => {
      if (isAlias(node) || node.anchor || node.tag) {
        reusesNodes = true
        return visit.BREAK
      }
    },
  })
  if (reusesNodes) return { ok: false, error: "YAML anchors, aliases and tags are not allowed" }
  return { ok: true, value: doc.toJS() }
}

function compileCondition(source: string): { ok: true; evaluate: Evaluate } | { ok: false; error: string } {
  let evaluate: Evaluate
  try {
    evaluate = plan(celEnv(), parse(source))
  } catch (error) {
    return { ok: false, error: `if: ${toError(error).message}` }
  }
  try {
    const dryRun = evaluate({ body: {}, event: "", headers: {} })
    if (isCelError(dryRun) && dryRun.message === UNRESOLVED_ATTRIBUTE) {
      return { ok: false, error: "if: the condition may only use body, event and headers" }
    }
  } catch (error) {
    return { ok: false, error: `if: ${toError(error).message}` }
  }
  return { ok: true, evaluate }
}

function matchEvent(events: EventTypes, event: string, body: JsonValue): WebhookFilterVerdict {
  const types = events.get(event)
  if (types === undefined) return { matched: false, reason: `event "${event}" not in on` }
  if (types === null) return { matched: true }
  const action = resolveJsonPath(body, "action")
  const actionName = typeof action === "string" ? action : ""
  if (!types.includes(actionName)) return { matched: false, reason: `action "${actionName}" not in types` }
  return { matched: true }
}

function matchCondition(evaluate: Evaluate, input: WebhookFilterInput, event: string): WebhookFilterVerdict {
  let result: CelResult
  try {
    result = evaluate({ body: input.body, event, headers: projectHeaders(input.headers) })
  } catch (error) {
    return { matched: false, reason: `if: error ${toError(error).message}` }
  }
  if (isCelError(result)) return { matched: false, reason: `if: error ${result.message}` }
  return result === true ? { matched: true } : { matched: false, reason: "if: false" }
}

export function rejectingWebhookFilter(error: string): WebhookFilter {
  return { match: () => ({ matched: false, reason: `filter invalid: ${error}` }) }
}

export function compileWebhookFilter(source: string): WebhookFilterCompilation {
  if (source.length > WEBHOOK_FILTER_MAX_CHARS) {
    return { ok: false, errors: [`Filter must be at most ${WEBHOOK_FILTER_MAX_CHARS} characters`] }
  }
  const yaml = parseYaml(source)
  if (!yaml.ok) return { ok: false, errors: [`Filter is not valid YAML: ${yaml.error}`] }
  const shape = filterSchema.safeParse(yaml.value)
  if (!shape.success) return { ok: false, errors: shape.error.issues.map((issue) => `Filter: ${describeIssue(issue)}`) }

  const events = shape.data.on === undefined ? null : normalizeOn(shape.data.on)
  let condition: Evaluate | null = null
  if (shape.data.if !== undefined) {
    const compiled = compileCondition(shape.data.if)
    if (!compiled.ok) return { ok: false, errors: [`Filter: ${compiled.error}`] }
    condition = compiled.evaluate
  }

  return {
    ok: true,
    filter: {
      match(input) {
        const event = input.headers.get(EVENT_HEADER) ?? ""
        if (events) {
          const verdict = matchEvent(events, event, input.body)
          if (!verdict.matched) return verdict
        }
        return condition ? matchCondition(condition, input, event) : { matched: true }
      },
    },
  }
}
