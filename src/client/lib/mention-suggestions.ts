export interface MentionTrigger {
  open: boolean
  query: string
  tokenStart: number
}

const CLOSED: MentionTrigger = { open: false, query: "", tokenStart: -1 }

export function shouldShowMentionPicker(value: string, caret: number): MentionTrigger {
  if (caret <= 0) return CLOSED
  const upToCaret = value.slice(0, caret)

  let atIndex = -1
  for (let i = upToCaret.length - 1; i >= 0; i--) {
    const ch = upToCaret[i]
    if (ch === "@") { atIndex = i; break }
    if (ch === " " || ch === "\n" || ch === "\t") return CLOSED
  }
  if (atIndex === -1) return CLOSED

  const before = atIndex === 0 ? "" : upToCaret[atIndex - 1]
  if (before !== "" && before !== " " && before !== "\n" && before !== "\t") return CLOSED

  return { open: true, query: upToCaret.slice(atIndex + 1), tokenStart: atIndex }
}

export function applyMentionToInput(args: {
  value: string
  caret: number
  tokenStart: number
  pickedPath: string
}): { value: string; caret: number } {
  const before = args.value.slice(0, args.tokenStart)
  const after = args.value.slice(args.caret)
  const replacement = `@${args.pickedPath}`
  const nextValue = `${before}${replacement}${after}`
  const nextCaret = before.length + replacement.length
  return { value: nextValue, caret: nextCaret }
}
