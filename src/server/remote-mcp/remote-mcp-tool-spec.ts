import type { ServerContext, ToolAnnotations } from "@modelcontextprotocol/server"
import type { z } from "zod"
import { COMMAND_REGISTRY, type ClientCommand, type CommandType } from "../../shared/commands"
import type { SubscriptionTopic } from "../../shared/protocol"
import type { ToolResult } from "../kanna-mcp-tool"
import type { RemoteMcpHost } from "./remote-mcp-server"
import type { ToolRegistrar } from "./remote-mcp-tool-registrar"
import { commandResult } from "./remote-mcp-views"

type RegisteredCommand = (typeof COMMAND_REGISTRY)[number]

export type DefinitionOf<K extends CommandType> = Extract<RegisteredCommand, { type: K }>
export type CommandOf<K extends CommandType> = Extract<ClientCommand, { type: K }>
export type ParamsOf<K extends CommandType> = DefinitionOf<K>["params"]

export type HiddenFields<K extends CommandType> = {
  readonly [Field in keyof ParamsOf<K>["shape"]]?: string
}

export type ToolBacking =
  | {
    readonly kind: "command"
    readonly command: CommandType
    readonly hidden: Readonly<Record<string, string>>
  }
  | {
    readonly kind: "topic"
    readonly topic: SubscriptionTopic["type"]
    readonly commands: readonly CommandType[]
  }
  | { readonly kind: "mcp-only"; readonly reason: string }

export interface RemoteTool {
  readonly name: string
  readonly backing: ToolBacking
  readonly input: z.ZodObject
  register(tools: ToolRegistrar, host: RemoteMcpHost): void
}

interface ToolMeta {
  readonly name: string
  readonly title: string
  readonly description: string
  readonly annotations?: ToolAnnotations
}

export interface ToolCall {
  readonly host: RemoteMcpHost
  readonly ctx: ServerContext
}

export interface CommandToolCall<K extends CommandType> extends ToolCall {
  run(command: CommandOf<K>): Promise<ToolResult>
}

type Handler<Shape extends z.ZodObject, Call extends ToolCall> = (args: z.output<Shape>, call: Call) => ToolResult | Promise<ToolResult>

export interface CommandToolSpec<K extends CommandType, Shape extends z.ZodObject> extends ToolMeta {
  readonly command: K
  readonly input: (params: ParamsOf<K>) => Shape
  readonly hidden?: HiddenFields<K>
  readonly handle: Handler<Shape, CommandToolCall<K>>
}

export interface TopicToolSpec<Shape extends z.ZodObject> extends ToolMeta {
  readonly topic: SubscriptionTopic["type"]
  readonly commands?: readonly CommandType[]
  readonly input: Shape
  readonly handle: Handler<Shape, ToolCall>
}

export interface McpOnlyToolSpec<Shape extends z.ZodObject> extends ToolMeta {
  readonly reason: string
  readonly input: Shape
  readonly handle: Handler<Shape, ToolCall>
}

function belongsTo<K extends CommandType>(
  type: K,
  definition: RegisteredCommand,
  _params: RegisteredCommand["params"],
): _params is ParamsOf<K> {
  return definition.type === type
}

function paramsOf<K extends CommandType>(type: K): ParamsOf<K> {
  for (const definition of COMMAND_REGISTRY) {
    const params = definition.params
    if (belongsTo(type, definition, params)) return params
  }
  throw new Error(`No command "${type}" in the registry`)
}

function hiddenReasons(hidden: object | undefined): Record<string, string> {
  const reasons: Record<string, string> = {}
  for (const [field, reason] of Object.entries(hidden ?? {})) {
    if (typeof reason === "string") reasons[field] = reason
  }
  return reasons
}

function assemble<Shape extends z.ZodObject, Call extends ToolCall>(
  meta: ToolMeta,
  backing: ToolBacking,
  input: Shape,
  handle: Handler<Shape, Call>,
  callFor: (call: ToolCall) => Call,
): RemoteTool {
  return {
    name: meta.name,
    backing,
    input,
    register(tools, host) {
      tools.registerTool(
        meta.name,
        { title: meta.title, description: meta.description, inputSchema: input, annotations: meta.annotations },
        (args, ctx) => handle(args, callFor({ host, ctx })),
      )
    },
  }
}

export function commandTool<K extends CommandType, Shape extends z.ZodObject>(spec: CommandToolSpec<K, Shape>): RemoteTool {
  const input = spec.input(paramsOf(spec.command))
  return assemble(
    spec,
    { kind: "command", command: spec.command, hidden: hiddenReasons(spec.hidden) },
    input,
    spec.handle,
    (call): CommandToolCall<K> => ({ ...call, run: (command) => commandResult(call.host, command) }),
  )
}

export function topicTool<Shape extends z.ZodObject>(spec: TopicToolSpec<Shape>): RemoteTool {
  return assemble(
    spec,
    { kind: "topic", topic: spec.topic, commands: spec.commands ?? [] },
    spec.input,
    spec.handle,
    (call) => call,
  )
}

export function mcpOnlyTool<Shape extends z.ZodObject>(spec: McpOnlyToolSpec<Shape>): RemoteTool {
  return assemble(spec, { kind: "mcp-only", reason: spec.reason }, spec.input, spec.handle, (call) => call)
}
