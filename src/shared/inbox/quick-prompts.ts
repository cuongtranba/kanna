export interface InboxQuickPrompt {
  id: string
  label: string
  instruction: string
}

export const INBOX_QUICK_PROMPTS: readonly InboxQuickPrompt[] = [
  { id: "shorter", label: "Shorter", instruction: "Rewrite the draft shorter, keeping its meaning." },
  { id: "polite", label: "More polite", instruction: "Rewrite the draft to be more polite, keeping its meaning." },
  {
    id: "translate",
    label: "Translate",
    instruction: "Translate the draft into English; if it is already English, into the sender's language.",
  },
  {
    id: "sender-language",
    label: "Reply in sender's language",
    instruction: "Rewrite the draft in the language the sender wrote in, keeping its meaning.",
  },
]

export function quickPromptLabel(instruction: string): string | undefined {
  return INBOX_QUICK_PROMPTS.find((prompt) => prompt.instruction === instruction)?.label
}
