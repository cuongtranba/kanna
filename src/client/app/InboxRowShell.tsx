import { StateMarkLabel } from "../components/ui/state-mark"
import type { InboxStateDisplay } from "../lib/inboxPresentation"
import { cn } from "../lib/utils"
import { InboxAvatar } from "./InboxAvatar"

export interface InboxRowSelection {
  checked: boolean
  anyChecked: boolean
  label: string
  onToggle: () => void
}

interface Props {
  unread: boolean
  selected: boolean
  avatarName: string
  title: string
  subtitle: string
  age: string | null
  preview: string
  display: InboxStateDisplay
  meta?: string
  selection?: InboxRowSelection
  onClick: () => void
}

export function InboxRowShell({ unread, selected, avatarName, title, subtitle, age, preview, display, meta, selection, onClick }: Props) {
  return (
    <div className="group relative">
      <button
        type="button"
        onClick={onClick}
        aria-current={selected ? "true" : undefined}
        className={cn(
          "flex w-full items-start gap-2.5 px-4 py-3 text-left transition-colors duration-[var(--motion-quick)] motion-reduce:transition-none",
          selected && "bg-muted",
          !selected && selection?.checked === true && "bg-accent",
          !selected && selection?.checked !== true && "hover:bg-muted/50",
          selection !== undefined && "[@media(hover:none)]:pl-14",
        )}
      >
        <span aria-hidden="true" className={cn("mt-[14px] h-2 w-2 shrink-0 rounded-full", unread ? "bg-info" : "bg-transparent")} />
        <InboxAvatar name={avatarName} />
        <span className="flex min-w-0 flex-1 flex-col gap-1">
          <span className="flex items-baseline gap-2">
            <span className={cn("min-w-0 flex-1 truncate text-sm text-foreground", unread ? "font-semibold" : "font-medium")}>
              {unread ? <span className="sr-only">Unread. </span> : null}
              {title}
              <span className="font-normal text-muted-foreground"> · {subtitle}</span>
            </span>
            {age === null ? null : <span className="shrink-0 font-mono text-xs tabular-nums text-muted-foreground">{age}</span>}
          </span>
          <span className="line-clamp-2 break-words text-xs text-muted-foreground">{preview}</span>
          <span className="flex items-center gap-3">
            <StateMarkLabel tone={display.tone} label={display.label} className="shrink-0" />
            {meta === undefined ? null : <span className="font-mono text-xs tabular-nums text-muted-foreground">{meta}</span>}
          </span>
        </span>
      </button>
      {selection === undefined ? null : <InboxRowCheckbox selection={selection} />}
    </div>
  )
}

function InboxRowCheckbox({ selection }: { selection: InboxRowSelection }) {
  return (
    <span
      className={cn(
        "absolute left-[34px] top-3 flex h-8 w-8 items-center justify-center rounded-full bg-background",
        "[@media(hover:none)]:left-1 [@media(hover:none)]:top-[6px] [@media(hover:none)]:h-11 [@media(hover:none)]:w-11",
        "pointer-events-none opacity-0 focus-within:pointer-events-auto focus-within:opacity-100 group-hover:pointer-events-auto group-hover:opacity-100 [@media(hover:none)]:pointer-events-auto [@media(hover:none)]:opacity-100",
        (selection.checked || selection.anyChecked) && "pointer-events-auto opacity-100",
      )}
    >
      <input
        type="checkbox"
        aria-label={selection.label}
        checked={selection.checked}
        onChange={selection.onToggle}
        className="h-4 w-4 shrink-0 cursor-pointer rounded border-border accent-foreground"
      />
    </span>
  )
}
