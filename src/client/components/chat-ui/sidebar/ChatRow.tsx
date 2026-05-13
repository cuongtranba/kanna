import { memo } from "react"
import { Archive, Split } from "lucide-react"
import type { SidebarChatRow } from "../../../../shared/types"
import { Button } from "../../ui/button"
import { Kbd } from "../../ui/kbd"
import { cn, normalizeChatId } from "../../../lib/utils"
import { formatCompactDuration, formatLiveDuration } from "../../../lib/formatDuration"
import { statusLabel } from "../../../lib/statusLabel"
import { ChatRowMenu } from "./Menus"

interface Props {
  chat: SidebarChatRow
  activeChatId: string | null
  nowMs: number
  shortcutHint?: string | null
  showShortcutHint?: boolean
  onSelectChat: (chatId: string) => void
  onRenameChat: (chatId: string) => void
  onShareChat: (chatId: string) => void
  onOpenInFinder: (localPath: string) => void
  onForkChat: (chatId: string) => void
  onArchiveChat: (chatId: string) => void
  onDeleteChat: (chatId: string) => void
}

type DotTone = "warning" | "info" | "success" | "destructive" | null

function dotToneFor(chat: SidebarChatRow): DotTone {
  if (chat.status === "running" || chat.status === "starting") return "warning"
  if (chat.status === "waiting_for_user") return "info"
  if (chat.status === "failed") return "destructive"
  if (chat.unread) return "success"
  return null
}

function dotBgClass(tone: DotTone): string {
  switch (tone) {
    case "warning": return "bg-warning"
    case "info": return "bg-info"
    case "success": return "bg-success"
    case "destructive": return "bg-destructive"
    default: return ""
  }
}

function dotTextClass(tone: DotTone): string {
  switch (tone) {
    case "warning": return "text-warning"
    case "info": return "text-info"
    case "success": return "text-success"
    case "destructive": return "text-destructive"
    default: return "text-muted-foreground"
  }
}

function ChatRowImpl({
  chat,
  activeChatId,
  nowMs,
  shortcutHint = null,
  showShortcutHint = false,
  onSelectChat,
  onRenameChat,
  onShareChat,
  onOpenInFinder,
  onForkChat,
  onArchiveChat,
  onDeleteChat,
}: Props) {
  const isLiveState = (chat.status === "running" || chat.status === "waiting_for_user") && chat.stateEnteredAt != null
  const stampLabel = isLiveState && chat.stateEnteredAt != null
    ? `${statusLabel(chat.status)} ${formatLiveDuration(nowMs - chat.stateEnteredAt)}`
    : formatCompactDuration(nowMs - (chat.lastMessageAt ?? chat._creationTime))

  const trailingLabel = showShortcutHint && shortcutHint ? shortcutHint : stampLabel
  const showShortcutKeycap = showShortcutHint && Boolean(shortcutHint)
  const normalizedChatId = normalizeChatId(chat.chatId)
  const isActive = activeChatId === normalizedChatId

  const tone = dotToneFor(chat)
  const trailingSlotWidth = chat.canFork
    ? "w-12"
    : isLiveState
      ? "w-12 md:w-20"
      : "w-6 md:w-14"

  const row = (
    <div
      key={chat._id}
      data-chat-id={normalizedChatId}
      className={cn(
        "group flex items-center gap-2 pl-2 pr-1 py-1.5 rounded-md cursor-pointer transition-colors duration-150",
        isActive
          ? "bg-muted"
          : "hover:bg-muted/40"
      )}
      onClick={() => onSelectChat(chat.chatId)}
    >
      <span
        className="relative flex h-3.5 w-3.5 shrink-0 items-center justify-center"
        aria-hidden
      >
        {tone ? (
          <span className={cn("h-2 w-2 rounded-full", dotBgClass(tone))} />
        ) : null}
      </span>
      <span
        className={cn(
          "truncate flex-1 text-sm",
          isActive ? "text-foreground font-medium" : "text-foreground/90",
          chat.status === "idle" && !chat.unread && !isActive ? "text-muted-foreground" : ""
        )}
      >
        {chat.title}
      </span>
      <div className={cn("relative h-6 shrink-0", trailingSlotWidth)}>
        {trailingLabel ? (
          showShortcutKeycap ? (
            <span className="hidden md:flex absolute inset-0 items-center justify-end pr-0.5 text-[11px] text-foreground transition-opacity duration-150 group-hover:opacity-0">
              <Kbd className="h-4 min-w-4 rounded-sm border-border/50 bg-transparent px-1 text-[10px]">
                {shortcutHint}
              </Kbd>
            </span>
          ) : (
            <span
              className={cn(
                "hidden md:flex absolute inset-0 items-center justify-end pr-1 text-[11px] tabular-nums transition-opacity duration-150 group-hover:opacity-0 whitespace-nowrap",
                isLiveState ? dotTextClass(tone) : "text-muted-foreground"
              )}
            >
              {trailingLabel}
            </span>
          )
        ) : null}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-end gap-0 transition-opacity duration-150",
            trailingLabel
              ? "opacity-100 md:opacity-0 md:group-hover:opacity-100"
              : "opacity-100"
          )}
        >
          {chat.canFork ? (
            <Button
              variant="ghost"
              size="icon"
              className="h-6 w-6 cursor-pointer rounded-sm hover:!bg-transparent !border-0"
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
            className="h-6 w-6 cursor-pointer rounded-sm hover:!bg-transparent !border-0"
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
    </div>
  )

  return (
    <ChatRowMenu
      canFork={chat.canFork}
      onRename={() => onRenameChat(chat.chatId)}
      onShare={() => onShareChat(chat.chatId)}
      onOpenInFinder={() => onOpenInFinder(chat.localPath)}
      onFork={() => onForkChat(chat.chatId)}
      onArchive={() => onArchiveChat(chat.chatId)}
      onDelete={() => onDeleteChat(chat.chatId)}
    >
      {row}
    </ChatRowMenu>
  )
}

export const ChatRow = memo(ChatRowImpl)
