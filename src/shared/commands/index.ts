import { z } from "zod"
import { isJsonObject, safeJsonParse, type JsonObject, type JsonValue } from "../json"
import { boardCommands } from "./board"
import { chatCommands } from "./chat"
import { defineCommands, type CommandAckResult, type CommandRisk, type ParseOutcome, type RemotePolicy } from "./define"
import { gitCommands } from "./git"
import { inboxCommands } from "./inbox"
import { pluginsCommands } from "./plugins"
import { projectCommands } from "./project"
import { pushCommands } from "./push"
import { settingsCommands } from "./settings"
import { shareCommands } from "./share"
import { systemCommands } from "./system"

export type { CommandAckResult, CommandRisk, RemotePolicy }

export const COMMAND_REGISTRY = defineCommands(
  ...projectCommands,
  ...systemCommands,
  ...settingsCommands,
  ...chatCommands,
  ...gitCommands,
  ...boardCommands,
  ...pushCommands,
  ...inboxCommands,
  ...shareCommands,
  ...pluginsCommands,
)

type RegisteredCommand = (typeof COMMAND_REGISTRY)[number]

export type CommandType = RegisteredCommand["type"]
export type ClientCommand = z.output<RegisteredCommand["schema"]>
type ResultSchemaOf<D> = D extends { readonly result: infer R } ? Exclude<R, undefined> : never
type ResultOf<D, Fallback> = D extends { readonly type: string }
  ? [ResultSchemaOf<D>] extends [never]
    ? Fallback
    : ResultSchemaOf<D> extends z.ZodType
      ? z.output<ResultSchemaOf<D>>
      : Fallback
  : never

export type CommandResult<C extends ClientCommand, Fallback = CommandAckResult> = ResultOf<
  Extract<RegisteredCommand, { readonly type: C["type"] }>,
  Fallback
>
export type ShareClientCommand = Extract<ClientCommand, { type: `share.${string}` }>

const REGISTERED_BY_TYPE: ReadonlyMap<string, RegisteredCommand> = new Map(
  COMMAND_REGISTRY.map((definition): [string, RegisteredCommand] => [definition.type, definition]),
)

export function isCommandType(type: string): type is CommandType {
  return REGISTERED_BY_TYPE.has(type)
}

export function commandDomain(type: CommandType): string {
  return type.slice(0, type.indexOf("."))
}

export type ParseClientCommandResult = ParseOutcome<ClientCommand>

export function parseClientCommand(json: JsonValue): ParseClientCommandResult {
  if (!isJsonObject(json)) return { ok: false, error: "A command must be a JSON object" }
  const type = json.type
  if (typeof type !== "string") return { ok: false, error: "A command needs a string \"type\"" }
  const definition = REGISTERED_BY_TYPE.get(type)
  if (!definition) return { ok: false, error: `Unknown command "${type}"` }
  return definition.parse(json)
}

export interface CommandDescriptor {
  readonly type: CommandType
  readonly domain: string
  readonly summary: string
  readonly risk: CommandRisk
  readonly remote: RemotePolicy
  readonly paramsSchema: JsonObject
  readonly resultSchema?: JsonObject
}

function renderJsonSchema(schema: z.ZodType, io: "input" | "output"): JsonObject {
  const rendered = safeJsonParse(JSON.stringify(z.toJSONSchema(schema, { io, unrepresentable: "any" })))
  if (rendered === null || !isJsonObject(rendered)) return {}
  const { $schema: _dialect, ...rest } = rendered
  return rest
}

const DESCRIPTOR_CACHE = new Map<CommandType, CommandDescriptor>()

function describeCommand(definition: RegisteredCommand): CommandDescriptor {
  const cached = DESCRIPTOR_CACHE.get(definition.type)
  if (cached) return cached
  const descriptor: CommandDescriptor = {
    type: definition.type,
    domain: commandDomain(definition.type),
    summary: definition.summary,
    risk: definition.risk,
    remote: definition.remote,
    paramsSchema: renderJsonSchema(definition.params, "input"),
    ...(definition.result ? { resultSchema: renderJsonSchema(definition.result, "output") } : {}),
  }
  DESCRIPTOR_CACHE.set(definition.type, descriptor)
  return descriptor
}

export function listCommandDescriptors(domain?: string): CommandDescriptor[] {
  return COMMAND_REGISTRY.map(describeCommand)
    .filter((descriptor) => domain === undefined || descriptor.domain === domain)
    .sort((left, right) => left.type.localeCompare(right.type))
}

export function remotePolicyOf(type: CommandType): RemotePolicy {
  const definition = REGISTERED_BY_TYPE.get(type)
  return definition ? definition.remote : { kind: "allowed" }
}
