import type { AgentProvider } from "../core-types"

export type InboundHandlerMode = "notify" | "inline" | "spawn"

export const INBOUND_HANDLER_MODES: readonly InboundHandlerMode[] = ["notify", "inline", "spawn"]

export const INBOUND_PROMPT_BODY_MAX_CHARS = 16000

export interface InboundHandler {
  mode: InboundHandlerMode
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

export function isInboundHandlerMode(value: string): value is InboundHandlerMode {
  return INBOUND_HANDLER_MODES.some((mode) => mode === value)
}

export function validateInboundTarget(handler: InboundTargetFields): string[] {
  const needsChat = handler.mode === "notify" || handler.mode === "inline"
  if (needsChat && !handler.chatId) return ["A chat is required for notify and inline hooks"]
  if (handler.mode === "spawn" && !handler.projectId) return ["A project is required for spawn hooks"]
  return []
}
