import { type ReactNode, memo } from "react"
import { Archive, BellOff, Check, ShieldAlert, Split } from "lucide-react"
import type { SidebarChatRow } from "../../../../shared/types"
import { Button } from "../../ui/button"
import { Kbd } from "../../ui/kbd"
import { HoverHint } from "../../ui/truncated-text"
import { SessionMark } from "../../ui/session-mark"
import { cn, normalizeChatId } from "../../../lib/utils"
import { formatCompactDuration, formatLiveDuration } from "../../../lib/formatDuration"
import { statusLabel } from "../../../lib/statusLabel"
import {
  chatDotBgClass,
  chatDotTextClass,
  chatStatusIndicator,
  sessionStateBadge,
} from "../../../lib/chatStatusIndicator"
import { ChatRowMenu } from "./Menus"

interface Props {
  chat: SidebarChatRow
  activeChatId: string | null
  nowMs: number
  shortcutHint?: string | null
  showShortcutHint?: boolean
  onSelectChat: (chatId: string) => void
  onRenameChat: (chatId: string) => void
  onOpenInFinder: (localPath: string) => void
  onForkChat: (chatId: string) => void
  onArchiveChat: (chatId: string) => void
  onDeleteChat: (chatId: string) => void
  onEditPermissions?: (chatId: string) => void
  silent?: boolean
  isSelected?: boolean
  onToggleSelect?: () => void
}

function ChatRowImpl({
  chat,
  activeChatId,
  nowMs,
  shortcutHint = null,
  showShortcutHint = false,
  onSelectChat,
  onRenameChat,
  onOpenInFinder,
  onForkChat,
  onArchiveChat,
  onDeleteChat,
  onEditPermissions,
  silent = false,
  isSelected = false,
  onToggleSelect,
}: Props) {
  const isLiveState = (chat.status === "running" || chat.status === "waiting_for_user") && chat.stateEnteredAt != null
  const stampLabel = isLiveState && chat.stateEnteredAt != null
    ? `${statusLabel(chat.status)} ${formatLiveDuration(nowMs - chat.stateEnteredAt)}`
    : formatCompactDuration(nowMs - (chat.lastMessageAt ?? chat._creationTime))

  const trailingLabel = showShortcutHint && shortcutHint ? shortcutHint : stampLabel
  const showShortcutKeycap = showShortcutHint && Boolean(shortcutHint)
  const normalizedChatId = normalizeChatId(chat.chatId)
  const isActive = activeChatId === normalizedChatId

  const tone = chatStatusIndicator(chat)?.tone ?? null
  const minSlotWidth = chat.canFork ? "min-w-12" : "min-w-6"

  let rowBgClass: string
  if (onToggleSelect) {
    rowBgClass = isSelected ? "bg-muted/60" : "hover:bg-muted/40"
  } else {
    rowBgClass = isActive ? "bg-muted" : "hover:bg-muted/40"
  }

  let leadingIndicator: ReactNode
  if (onToggleSelect) {
    const checkboxBorderBg = isSelected
      ? "border-foreground bg-foreground"
      : "border-muted-foreground/50 bg-transparent"
    leadingIndicator = (
      <span className={cn(
        "flex h-3.5 w-3.5 rounded-sm border items-center justify-center transition-colors duration-100",
        checkboxBorderBg
      )}>
        {isSelected && <Check className="h-2.5 w-2.5 text-background" strokeWidth={3} />}
      </span>
    )
  } else {
    leadingIndicator = tone
      ? <span className={cn("h-2 w-2 rounded-full", chatDotBgClass(tone))} />
      : null
  }

  let trailingLabelContent: ReactNode = null
  if (trailingLabel) {
    if (showShortcutKeycap) {
      trailingLabelContent = (
        <span className="hidden md:flex items-center justify-end pr-0.5 text-xs text-foreground transition-opacity duration-150 group-hover:opacity-0">
          <Kbd className="h-4 min-w-4 rounded-sm border-border/50 bg-transparent px-1 text-xs">
            {shortcutHint}
          </Kbd>
        </span>
      )
    } else {
      trailingLabelContent = (
        <span
          className={cn(
            "hidden md:flex items-center justify-end pr-1 text-xs tabular-nums transition-opacity duration-150 group-hover:opacity-0 whitespace-nowrap",
            isLiveState ? chatDotTextClass(tone) : "text-muted-foreground"
          )}
        >
          {trailingLabel}
        </span>
      )
    }
  }

  const mainAction = (
    <button
      type="button"
      /*
        Press feedback. Forgiving on a mis-tap, and on a phone it is the only
        acknowledgement a 44px target gives before the route changes — without
        it a tap on a slow connection looks like it missed.
      */
      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left origin-left transition-transform duration-[var(--motion-instant)] ease-[var(--motion-ease-arriving)] active:scale-[0.985] motion-reduce:transition-none motion-reduce:active:scale-100"
      onClick={() => onToggleSelect ? onToggleSelect() : onSelectChat(chat.chatId)}
      aria-pressed={onToggleSelect ? isSelected : undefined}
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        {leadingIndicator}
      </span>
      {(() => {
        const badge = sessionStateBadge(chat.sessionState)
        return badge ? (
          <HoverHint label={badge.title}>
            <span className={cn("flex shrink-0 items-center", badge.toneClass)} aria-label={badge.title}>
              <SessionMark kind={badge.kind} />
            </span>
          </HoverHint>
        ) : null
      })()}
      {chat.hasPolicyOverride ? (
        <ShieldAlert className="size-3 shrink-0 text-warning-text" aria-label="Per-chat permission override active" />
      ) : null}
      <span
        className={cn(
          "min-w-0 flex-1 truncate text-sm",
          isActive ? "font-medium text-foreground" : "text-foreground/90",
          chat.status === "idle" && !chat.unread && !isActive ? "text-muted-foreground" : "",
        )}
      >
        {chat.title}
      </span>
      {silent ? <BellOff className="size-3 shrink-0 text-muted-foreground" aria-label="Silenced" /> : null}
      {trailingLabelContent}
    </button>
  )

  const row = (
    <div
      key={chat._id}
      data-chat-id={normalizedChatId}
      className={cn(
        "group flex items-center rounded-md pr-1 transition-colors duration-[var(--motion-quick)]",
        rowBgClass
      )}
    >
      {onToggleSelect ? (
        mainAction
      ) : (
        <ChatRowMenu
          canFork={chat.canFork}
          onRename={() => onRenameChat(chat.chatId)}
          onOpenInFinder={() => onOpenInFinder(chat.localPath)}
          onFork={() => onForkChat(chat.chatId)}
          onArchive={() => onArchiveChat(chat.chatId)}
          onDelete={() => onDeleteChat(chat.chatId)}
          onEditPermissions={onEditPermissions ? () => onEditPermissions(chat.chatId) : undefined}
        >
          {mainAction}
        </ChatRowMenu>
      )}
      {!onToggleSelect && (
        /*
          The row's actions slide in from the right on hover instead of sitting
          there permanently. The trailing timestamp already fades out on
          `group-hover`, so the two read as one exchange: the stamp leaves, the
          actions take its place.

          Gated at `md:` on purpose. A touch device never fires hover, so the
          reveal would leave the actions permanently invisible — and below md
          the timestamp is `hidden`, making these the row's only trailing
          content. Mobile therefore keeps them shown, which is the same shape
          `LocalProjectsSection`'s section actions already use.

          CSS rather than Motion's spring (which the handoff asks for): this
          renders once per chat row, and a Motion component per row buys a
          spring's reversal-smoothness over 8px of travel at the cost of a
          runtime instance in a list that can run to hundreds. The token
          duration is the same gesture at a fraction of the price.
        */
        <div
          className={cn(
            "flex h-8 shrink-0 items-center justify-end gap-0",
            "transition-[opacity,transform] duration-[var(--motion-quick)] ease-[var(--motion-ease-arriving)] motion-reduce:transition-none",
            "md:translate-x-2 md:opacity-0 md:group-hover:translate-x-0 md:group-hover:opacity-100 md:focus-within:translate-x-0 md:focus-within:opacity-100",
            minSlotWidth
          )}
        >
          {chat.canFork ? (
            <Button
              variant="ghost"
              size="icon"
              className="size-8 cursor-pointer rounded-sm hover:!bg-transparent !border-0"
              onClick={(event) => {
                event.stopPropagation()
                onForkChat(chat.chatId)
              }}
              title="Fork chat"
            >
              <Split className="size-3.5" />
            </Button>
          ) : null}
          <Button
            variant="ghost"
            size="icon"
            className="size-8 cursor-pointer rounded-sm hover:!bg-transparent !border-0"
            onClick={(event) => {
              event.stopPropagation()
              onArchiveChat(chat.chatId)
            }}
            title="Archive chat"
          >
            <Archive className="size-3.5" />
          </Button>
        </div>
      )}
    </div>
  )

  return row
}

export const ChatRow = memo(ChatRowImpl)
