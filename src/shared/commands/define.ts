import { z } from "zod"
import type { JsonValue } from "../json"

export type CommandRisk = "read" | "write" | "destructive" | "local"

export type RemotePolicy =
  | { readonly kind: "allowed" }
  | { readonly kind: "excluded"; readonly reason: string }

export interface CommandSpec<S extends z.core.$ZodShape> {
  readonly params: z.ZodObject<S>
  readonly summary: string
  readonly risk: CommandRisk
  readonly remote: RemotePolicy
}

export const REMOTE_ALLOWED: RemotePolicy = { kind: "allowed" }

export function remoteExcluded(reason: string): RemotePolicy {
  return { kind: "excluded", reason }
}

export type ParseOutcome<Command> =
  | { ok: true; command: Command }
  | { ok: false; error: string }

const MAX_REPORTED_ISSUES = 5

function describeIssues(type: string, error: z.ZodError): string {
  const issues = error.issues.slice(0, MAX_REPORTED_ISSUES).map((issue) => {
    const path = issue.path.map(String).join(".")
    return path === "" ? issue.message : `${path}: ${issue.message}`
  })
  const extra = error.issues.length - issues.length
  const suffix = extra > 0 ? ` (+${extra} more)` : ""
  return `Invalid "${type}" command: ${issues.join("; ")}${suffix}`
}

export function defineCommand<const K extends string, S extends z.core.$ZodShape>(type: K, spec: CommandSpec<S>) {
  const schema = spec.params.extend({ type: z.literal(type) })
  return {
    type,
    params: spec.params,
    summary: spec.summary,
    risk: spec.risk,
    remote: spec.remote,
    schema,
    parse(json: JsonValue): ParseOutcome<z.output<typeof schema>> {
      const result = schema.safeParse(json)
      if (result.success) return { ok: true, command: result.data }
      return { ok: false, error: describeIssues(type, result.error) }
    },
  }
}

export type CommandDefinition = ReturnType<typeof defineCommand>

export function defineCommands<const T extends readonly CommandDefinition[]>(...definitions: T): T {
  return definitions
}

export const noParams = z.object({})
