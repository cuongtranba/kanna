const OPEN_TAG = "<system-message>"
const CLOSE_TAG = "</system-message>"

const STEERED_MESSAGE_INSTRUCTION = "The user would like to inform you of something while you continue to work. Acknowledge receipt immediately with a text response, then continue with the task at hand, incorporating the user's feedback if needed."

const STEERED_MESSAGE_PREFIX = `${OPEN_TAG}\n${STEERED_MESSAGE_INSTRUCTION}\n${CLOSE_TAG}`

const STEERED_ENVELOPE_REGEX = new RegExp(`^${OPEN_TAG}\\s*([\\s\\S]*?)\\s*${CLOSE_TAG}\\s*([\\s\\S]*)$`)

export interface UnwrappedSteeredMessage {
  systemMessage: string | null
  body: string
}

export function wrapSteeredMessage(content: string): string {
  return content.trim().length > 0
    ? `${STEERED_MESSAGE_PREFIX}\n\n${content}`
    : STEERED_MESSAGE_PREFIX
}

export function unwrapSteeredMessage(content: string): UnwrappedSteeredMessage {
  const match = content.match(STEERED_ENVELOPE_REGEX)
  if (!match) return { systemMessage: null, body: content }
  return { systemMessage: match[1]?.trim() || null, body: match[2] ?? "" }
}
