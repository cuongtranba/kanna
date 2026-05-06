import { memo } from "react"
import { Archive, Loader2, Split } from "lucide-react"
import type { SidebarChatRow } from "../../../../shared/types"
import { AnimatedShinyText } from "../../ui/animated-shiny-text"
import { Button } from "../../ui/button"
import { Kbd } from "../../ui/kbd"
import { cn, normalizeChatId } from "../../../lib/utils"
import { formatCompactDuration, formatLiveDuration } from "../../../lib/formatDuration"
import { ChatRowMenu } from "./Menus"

const loadingStatuses = new Set(["starting", "running"])

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
  const livePrefix = chat.status === "running" ? "run" : "wait"
  const stampLabel = isLiveState && chat.stateEnteredAt != null
    ? `${livePrefix} ${formatLiveDuration(nowMs - chat.stateEnteredAt)}`
    : formatCompactDuration(nowMs - (chat.lastMessageAt ?? chat._creationTime))

  const trailingLabel = showShortcutHint && shortcutHint ? shortcutHint : stampLabel
  const showShortcutKeycap = showShortcutHint && Boolean(shortcutHint)
  const normalizedChatId = normalizeChatId(chat.chatId)

  const row = (
    <div
      key={chat._id}
      data-chat-id={normalizedChatId}
      className={cn(
        "group flex items-center gap-2 pl-2.5 pr-0.5 py-0.5 rounded-lg cursor-pointer border-border/0 hover:border-border hover:bg-muted/20 active:scale-[0.985] border transition-all",
        activeChatId === normalizedChatId ? "bg-muted hover:bg-muted border-border" : "border-border/0 dark:hover:border-border/40 "
      )}
      onClick={() => onSelectChat(chat.chatId)}
    >
      {loadingStatuses.has(chat.status) ? (
        <Loader2 className="size-3.5 flex-shrink-0 animate-spin text-logo" />
      ) : chat.status === "waiting_for_user" ? (
        <div className="relative ">
          <div className=" rounded-full z-0 size-3.5 flex items-center justify-center ">
            <div className="absolute rounded-full z-0 size-2.5 bg-info/80 animate-ping" />
            <div className=" rounded-full z-0 size-2.5 bg-info ring-2 ring-muted/20 dark:ring-muted/50" />
          </div>
        </div>
      ) : chat.unread ? (
        <div className="relative ">
          <div className=" rounded-full z-0 size-3.5 flex items-center justify-center ">
            <div className="absolute rounded-full z-0 size-2.5 bg-success/80 animate-ping" />
            <div className=" rounded-full z-0 size-2.5 bg-success ring-2 ring-muted/20 dark:ring-muted/50" />
          </div>
        </div>
      ) : null}
      <span className="text-sm truncate flex-1 translate-y-[-0.5px]">
        {chat.status !== "idle" && chat.status !== "waiting_for_user" ? (
          <AnimatedShinyText
            animate={chat.status === "running"}
            shimmerWidth={Math.max(20, chat.title.length * 3)}
          >
            {chat.title}
          </AnimatedShinyText>
        ) : 
          chat.status !== 'idle' || activeChatId === normalizedChatId || chat.unread ? <span className="">{chat.title}</span> : <span className="text-slate-500 dark:text-slate-400">{chat.title}</span>
        }
      </span>
      <div className={cn("relative h-7 mr-[2px] shrink-0", chat.canFork ? "w-12" : "w-6")}>
        {trailingLabel ? (
          showShortcutKeycap ? (
            <span className="hidden md:flex absolute inset-0 items-center justify-end pr-0.5 text-[11px] text-foreground transition-opacity group-hover:opacity-0">
              <Kbd className="h-4 min-w-4 rounded-sm border-border/50 bg-transparent px-1 text-[10px]">
                {shortcutHint}
              </Kbd>
            </span>
          ) : (
            <span className="hidden md:flex absolute inset-0 items-center justify-end pr-1 text-[11px] text-muted-foreground tabular-nums opacity-60 transition-opacity group-hover:opacity-0">
              {trailingLabel}
            </span>
          )
        ) : null}
        <div
          className={cn(
            "absolute inset-0 flex items-center justify-end gap-0 opacity-100 mr-[3px]",
            trailingLabel
              ? "md:opacity-0 md:group-hover:opacity-100"
              : "opacity-100 md:opacity-0 md:group-hover:opacity-100"
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
