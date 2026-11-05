import { useCallback } from "react"
import { Button } from "../components/ui/button"
import { INBOX_QUICK_PROMPTS, type InboxQuickPrompt } from "../../shared/inbox/quick-prompts"
import type { InboxDraft } from "../../shared/inbox/types"
import { draftChipLabel } from "../lib/inboxPresentation"
import { useInboxStore } from "../stores/inboxStore"

interface DraftChipProps {
  threadId: string
  draft: InboxDraft
  version: number
  active: boolean
}

function DraftChip({ threadId, draft, version, active }: DraftChipProps) {
  const handleClick = useCallback(() => {
    useInboxStore.getState().loadDraftVersion(threadId, draft)
  }, [draft, threadId])
  return (
    <Button variant={active ? "secondary" : "ghost"} size="sm" aria-pressed={active} onClick={handleClick}>
      {draftChipLabel(draft, version)}
    </Button>
  )
}

interface DraftChipsProps {
  threadId: string
  drafts: readonly InboxDraft[]
  currentText: string
}

export function DraftChips({ threadId, drafts, currentText }: DraftChipsProps) {
  if (drafts.length === 0) return null
  return (
    <div role="group" aria-label="Draft versions" className="flex flex-wrap gap-1.5">
      {drafts
        .map((draft, index) => ({ draft, version: index + 1 }))
        .reverse()
        .map(({ draft, version }) => (
          <DraftChip key={draft.id} threadId={threadId} draft={draft} version={version} active={draft.text === currentText} />
        ))}
    </div>
  )
}

interface QuickPromptButtonProps {
  prompt: InboxQuickPrompt
  disabled: boolean
  onAsk: (prompt: InboxQuickPrompt) => void
}

function QuickPromptButton({ prompt, disabled, onAsk }: QuickPromptButtonProps) {
  const handleClick = useCallback(() => onAsk(prompt), [onAsk, prompt])
  return (
    <Button variant="ghost" size="sm" disabled={disabled} onClick={handleClick}>
      {prompt.label}
    </Button>
  )
}

interface QuickPromptsProps {
  disabled: boolean
  onAsk: (prompt: InboxQuickPrompt) => void
}

export function QuickPrompts({ disabled, onAsk }: QuickPromptsProps) {
  return (
    <div role="group" aria-label="Quick prompts" className="flex flex-wrap items-center gap-1.5">
      {INBOX_QUICK_PROMPTS.map((prompt) => (
        <QuickPromptButton key={prompt.id} prompt={prompt} disabled={disabled} onAsk={onAsk} />
      ))}
    </div>
  )
}
