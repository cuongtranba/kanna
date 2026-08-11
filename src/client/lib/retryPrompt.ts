import type { ChatAttachment, HydratedTranscriptMessage } from "../../shared/types"

export interface RetryPrompt {
  content: string
  attachments: ChatAttachment[]
}

const NO_ATTACHMENTS: ChatAttachment[] = []

/**
 * The prompt that started the turn a failed `result` ended — the nearest
 * preceding `user_prompt`, not the chat's latest one (`getPreviousPrompt`),
 * so retrying an older failure re-sends what that turn actually ran.
 */
export function findRetryPromptForResult(
  messages: readonly HydratedTranscriptMessage[],
  resultMessageId: string,
): RetryPrompt | null {
  const resultIndex = messages.findIndex((message) => message.id === resultMessageId)
  if (resultIndex < 0) return null

  for (let index = resultIndex - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.kind !== "user_prompt") continue
    const attachments = message.attachments ?? NO_ATTACHMENTS
    if (message.content.trim().length === 0 && attachments.length === 0) continue
    return { content: message.content, attachments: [...attachments] }
  }
  return null
}
