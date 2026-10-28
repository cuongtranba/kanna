import { isAgentProvider, type AgentProvider } from "../core-types"
import { oneOf } from "../vocab"

export const INBOUND_HANDLER_MODES = ["notify", "inline", "spawn"] as const
export type InboundHandlerMode = (typeof INBOUND_HANDLER_MODES)[number]

export const INBOUND_HANDLINGS = ["triage", "task"] as const
export type InboundHandling = (typeof INBOUND_HANDLINGS)[number]

export const INBOUND_PROMPT_BODY_MAX_CHARS = 16000

export const INBOUND_LIMITS = {
  nameMaxChars: 80,
  templateMaxChars: 8000,
  replyHintMaxChars: 2000,
  pathMaxChars: 200,
} as const

export interface InboundHandler {
  mode: InboundHandlerMode
  handling?: InboundHandling
  chatId?: string
  projectId?: string
  template: string
  replyHint: string
  pushEnabled: boolean
  provider?: AgentProvider
  model?: string
}

export interface InboundTargetFields {
  mode: InboundHandlerMode
  chatId?: string | null
  projectId?: string | null
}

export const isInboundHandlerMode = oneOf(INBOUND_HANDLER_MODES)

export const isInboundHandling = oneOf(INBOUND_HANDLINGS)

export function validateInboundTarget(handler: InboundTargetFields): string[] {
  const needsChat = handler.mode === "notify" || handler.mode === "inline"
  if (needsChat && !handler.chatId) return ["A chat is required for notify and inline hooks"]
  if (handler.mode === "spawn" && !handler.projectId) return ["A project is required for spawn hooks"]
  return []
}

export function inboundNameErrors(name: string): string[] {
  const trimmed = name.trim()
  if (trimmed.length === 0) return ["Name is required"]
  if (trimmed.length > INBOUND_LIMITS.nameMaxChars) {
    return [`Name must be at most ${INBOUND_LIMITS.nameMaxChars} characters`]
  }
  return []
}

export function inboundTemplateErrors(template: string, options: { required: boolean }): string[] {
  const trimmed = template.trim()
  if (trimmed.length === 0) return options.required ? ["Template is required"] : []
  if (trimmed.length > INBOUND_LIMITS.templateMaxChars) {
    return [`Template must be at most ${INBOUND_LIMITS.templateMaxChars} characters`]
  }
  return []
}

export function inboundPathErrors(paths: readonly (string | null | undefined)[]): string[] {
  return paths.some((path) => (path?.length ?? 0) > INBOUND_LIMITS.pathMaxChars)
    ? [`Paths must be at most ${INBOUND_LIMITS.pathMaxChars} characters`]
    : []
}

export function inboundReplyHintErrors(replyHint: string | null | undefined): string[] {
  return (replyHint?.length ?? 0) > INBOUND_LIMITS.replyHintMaxChars
    ? [`Reply hint must be at most ${INBOUND_LIMITS.replyHintMaxChars} characters`]
    : []
}

export function inboundHandlerTarget(
  mode: InboundHandlerMode,
  chatId: string,
  projectId: string,
): Pick<InboundHandler, "chatId" | "projectId"> {
  if (mode === "spawn") return projectId ? { projectId } : {}
  return chatId ? { chatId } : {}
}

export interface InboundModelChoice {
  provider: AgentProvider
  model: string
}

export function encodeInboundModelChoice(provider: AgentProvider, model: string): string {
  return `${provider}:${model}`
}

export function decodeInboundModelChoice(value: string): InboundModelChoice | null {
  const split = value.indexOf(":")
  if (split <= 0) return null
  const provider = value.slice(0, split)
  const model = value.slice(split + 1)
  if (!isAgentProvider(provider) || model.length === 0) return null
  return { provider, model }
}
