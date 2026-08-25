import { memo } from "react"
import { Archive, BellOff, ShieldAlert, Split } from "lucide-react"
import type { SidebarChatRow } from "../../../../shared/types"
import { Button } from "../../ui/button"
import { Kbd } from "../../ui/kbd"
import { HoverHint } from "../../ui/truncated-text"
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

  let trailingLabelContent: React.ReactNode = null
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
      className="flex min-w-0 flex-1 items-center gap-2 py-1.5 pl-2 text-left"
      onClick={() => onSelectChat(chat.chatId)}
    >
      <span className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden>
        {tone ? <span className={cn("h-2 w-2 rounded-full", chatDotBgClass(tone))} /> : null}
      </span>
      {(() => {
        const badge = sessionStateBadge(chat.sessionState)
        return badge ? (
          <HoverHint label={badge.title}>
            <span className={cn("shrink-0 text-xs leading-none", badge.toneClass)} aria-label={badge.title}>
              {badge.glyph}
            </span>
          </HoverHint>
        ) : null
      })()}
      {chat.hasPolicyOverride ? (
        <ShieldAlert className="size-3 shrink-0 text-warning" aria-label="Per-chat permission override active" />
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
        "group flex items-center rounded-md pr-1 transition-colors duration-150",
        isActive
          ? "bg-muted"
          : "hover:bg-muted/40"
      )}
    >
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
      <div className={cn("flex h-8 shrink-0 items-center justify-end gap-0", minSlotWidth)}>
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
    </div>
  )

  return row
}

export const ChatRow = memo(ChatRowImpl)
