import type { ReactElement } from "react"
import type { KeybindingAction } from "../../shared/app-settings-types"
import { Kbd, KbdGroup } from "../components/ui/kbd"
import { HoverHint } from "../components/ui/truncated-text"
import { useInboxShortcutKeys } from "./useInboxShortcutKeys"

interface Props {
  label: string
  action: KeybindingAction
  children: ReactElement
}

export function InboxShortcutHint({ label, action, children }: Props) {
  const keys = useInboxShortcutKeys(action)
  const content = (
    <span className="inline-flex items-center gap-2">
      {label}
      {keys.length === 0 ? null : (
        <KbdGroup>
          {keys.map((key) => (
            <Kbd key={key}>{key}</Kbd>
          ))}
        </KbdGroup>
      )}
    </span>
  )
  return <HoverHint label={content} side="bottom">{children}</HoverHint>
}
