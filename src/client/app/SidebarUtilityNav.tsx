import type { ReactNode } from "react"
import { CalendarClock, Inbox, Settings, Webhook, Workflow, type LucideIcon } from "lucide-react"
import { useLocation, useNavigate } from "react-router-dom"
import { cn } from "../lib/utils"
import { HoverHint } from "../components/ui/truncated-text"
import { formatUnreadBadge } from "../lib/inboxPresentation"
import { selectInboxUnreadCount, useInboxStore } from "../stores/inboxStore"
import { PluginSidebarItems } from "./PluginSidebarItems"
import type { PluginSidebarItem } from "../plugins/contributionRegistry"
import type { SocketStatus } from "./socket"

const WORKFLOWS_PREFIX = "/workflows"
const INBOX_PREFIX = "/inbox"
const CRON_PREFIX = "/cron"
const WEBHOOKS_PREFIX = "/webhooks"
const SETTINGS_PREFIX = "/settings"

const UTILITY_PREFIXES = [WORKFLOWS_PREFIX, INBOX_PREFIX, CRON_PREFIX, WEBHOOKS_PREFIX, SETTINGS_PREFIX]

export function isUtilityRoute(pathname: string): boolean {
  return pathname === "/" || UTILITY_PREFIXES.some((prefix) => pathname.startsWith(prefix))
}

const BUTTON_CLASS = "w-full flex items-center gap-2 px-3 py-2.5 text-left transition-colors duration-150 rounded-none"

interface UtilityButtonProps {
  readonly icon: LucideIcon
  readonly label: string
  readonly active: boolean
  readonly onClick: () => void
  readonly ariaLabel?: string
  readonly ariaDisabled?: boolean
  readonly className?: string
  readonly trailing?: ReactNode
}

function UtilityButton({ icon: Icon, label, active, onClick, ariaLabel, ariaDisabled, className, trailing }: UtilityButtonProps) {
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      aria-disabled={ariaDisabled}
      onClick={onClick}
      className={cn(BUTTON_CLASS, className ?? (active ? "bg-muted" : "hover:bg-muted/50"))}
    >
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
      <span className="text-sm flex-1">{label}</span>
      {trailing}
    </button>
  )
}

function connectionIndicator(status: SocketStatus): { dotClass: string; label: string } {
  if (status === "connecting") return { dotClass: "bg-warning", label: "Connecting" }
  if (status === "connected") return { dotClass: "bg-success", label: "Connected" }
  return { dotClass: "bg-warning", label: "Disconnected" }
}

export interface SidebarUtilityNavProps {
  readonly activeChatId: string | null
  readonly onClose: () => void
  readonly connectionStatus: SocketStatus
  readonly pluginItems: readonly PluginSidebarItem[]
  readonly onSelectPluginItem?: (item: PluginSidebarItem) => void
}

export function SidebarUtilityNav({
  activeChatId,
  onClose,
  connectionStatus,
  pluginItems,
  onSelectPluginItem,
}: SidebarUtilityNavProps) {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const inboxUnread = useInboxStore(selectInboxUnreadCount)
  const indicator = connectionIndicator(connectionStatus)

  const go = (path: string) => () => {
    navigate(path)
    onClose()
  }

  let workflowsClass: string
  if (!activeChatId) {
    workflowsClass = "opacity-60"
  } else if (pathname.startsWith(WORKFLOWS_PREFIX)) {
    workflowsClass = "bg-muted"
  } else {
    workflowsClass = "hover:bg-muted/50"
  }

  return (
    <div className="border-t border-border">
      <HoverHint label={activeChatId ? "Open workflows" : "Open a chat to view workflows"} side="right">
        <UtilityButton
          icon={Workflow}
          label="Workflows"
          active={pathname.startsWith(WORKFLOWS_PREFIX)}
          ariaDisabled={!activeChatId}
          ariaLabel={activeChatId ? "Workflows" : "Workflows — open a chat to view"}
          className={workflowsClass}
          onClick={activeChatId ? go(`${WORKFLOWS_PREFIX}/${activeChatId}`) : () => undefined}
        />
      </HoverHint>
      <UtilityButton
        icon={Inbox}
        label="Inbox"
        active={pathname.startsWith(INBOX_PREFIX)}
        ariaLabel={inboxUnread > 0 ? `Inbox, ${String(inboxUnread)} unread` : "Inbox"}
        onClick={go(INBOX_PREFIX)}
        trailing={inboxUnread > 0 ? (
          <span className="font-mono text-xs tabular-nums text-foreground">{formatUnreadBadge(inboxUnread)}</span>
        ) : null}
      />
      <UtilityButton icon={CalendarClock} label="Cron jobs" active={pathname.startsWith(CRON_PREFIX)} onClick={go(CRON_PREFIX)} />
      <UtilityButton icon={Webhook} label="Webhooks" active={pathname.startsWith(WEBHOOKS_PREFIX)} onClick={go(WEBHOOKS_PREFIX)} />
      <UtilityButton icon={Settings} label="Settings" active={pathname.startsWith(SETTINGS_PREFIX)} onClick={go(`${SETTINGS_PREFIX}/general`)} />
      <PluginSidebarItems items={pluginItems} onSelect={onSelectPluginItem} />
      <div className="flex items-center gap-2 px-3 pb-2.5 pt-0.5">
        <span
          className={cn("h-1.5 w-1.5 rounded-full shrink-0", indicator.dotClass)}
          aria-hidden
        />
        <span className="text-xs text-muted-foreground tabular-nums">{indicator.label}</span>
      </div>
    </div>
  )
}
