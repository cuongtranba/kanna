import { senderInitial } from "../lib/inboxPresentation"
import { cn } from "../lib/utils"

interface Props {
  name: string
  className?: string
}

export function InboxAvatar({ name, className }: Props) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border bg-muted text-xs font-medium text-muted-foreground",
        className,
      )}
    >
      {senderInitial(name)}
    </span>
  )
}
