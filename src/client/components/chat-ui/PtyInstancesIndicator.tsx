import { useCallback, useMemo, useState } from "react"
import type { PtyInstancePhase, PtyInstanceState } from "../../../shared/pty-instance"
import type { ClientCommand } from "../../../shared/protocol"
import { usePtyInstances, usePtyInstancesStore, usePtyLiveCount, usePtyPopoverOpen } from "../../stores/ptyInstancesStore"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "../ui/tooltip"
import type { KannaSocket } from "../../app/socket"

const PHASE_COLOR: Record<PtyInstancePhase, string> = {
  spawning: "var(--warning)",
  "trust-dialog": "var(--warning)",
  ready: "var(--success, oklch(0.72 0.16 145))",
  streaming: "var(--primary)",
  cancelling: "var(--warning)",
  exited: "var(--muted-foreground)",
}

const PHASE_LABEL: Record<PtyInstancePhase, string> = {
  spawning: "spawning",
  "trust-dialog": "trust",
  ready: "ready",
  streaming: "streaming",
  cancelling: "cancelling",
  exited: "exited",
}

function shortenCwd(cwd: string): string {
  if (cwd.length <= 40) return cwd
  return `…${cwd.slice(-39)}`
}

function shortenChat(chatId: string): string {
  return chatId.length > 8 ? chatId.slice(0, 8) : chatId
}

function formatUptime(startedAt: number, exitedAt: number | null): string {
  const ref = exitedAt ?? Date.now()
  const ms = Math.max(0, ref - startedAt)
  const s = Math.floor(ms / 1000)
  if (s < 60) return `${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  const kb = bytes / 1024
  if (kb < 1024) return `${kb.toFixed(0)} KB`
  const mb = kb / 1024
  if (mb < 1024) return `${mb.toFixed(0)} MB`
  const gb = mb / 1024
  return `${gb.toFixed(1)} GB`
}

export function formatPercent(pct: number): string {
  if (pct >= 100) return `${pct.toFixed(0)}%`
  if (pct >= 10) return `${pct.toFixed(1)}%`
  return `${pct.toFixed(1)}%`
}

interface RowProps {
  instance: PtyInstanceState
  onOpenChat: (chatId: string) => void
  onCancel: (chatId: string) => void
  onKill: (chatId: string) => void
}

function StatusPill({ phase }: { phase: PtyInstancePhase }) {
  return (
    <span
      className="inline-flex items-center gap-1.5 px-1.5 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wide tabular-nums"
      style={{ background: "color-mix(in oklch, var(--muted) 60%, transparent)" }}
    >
      <span
        aria-hidden
        className="inline-block w-[6px] h-[6px] rounded-full"
        style={{ backgroundColor: PHASE_COLOR[phase] }}
      />
      <span style={{ color: PHASE_COLOR[phase] }}>{PHASE_LABEL[phase]}</span>
    </span>
  )
}

export function PtyInstanceRow({ instance, onOpenChat, onCancel, onKill }: RowProps) {
  const [confirmKill, setConfirmKill] = useState(false)

  const handleKillClick = useCallback(() => {
    if (confirmKill) {
      onKill(instance.chatId)
      setConfirmKill(false)
    } else {
      setConfirmKill(true)
    }
  }, [confirmKill, instance.chatId, onKill])

  return (
    <div className="group border border-border/60 rounded-lg p-3 flex flex-col gap-2 hover:border-border transition-colors">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onOpenChat(instance.chatId)}
          className="text-xs font-mono font-medium text-foreground hover:text-primary transition-colors text-left truncate flex-1 min-w-0"
        >
          {shortenChat(instance.chatId)}
        </button>
        <StatusPill phase={instance.phase} />
      </div>

      <div className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px] text-muted-foreground font-mono tabular-nums">
        <div className="truncate" title={instance.cwd}>
          <span className="text-foreground/40">cwd</span> {shortenCwd(instance.cwd)}
        </div>
        <div>
          <span className="text-foreground/40">pid</span> {instance.pid ?? "—"}
        </div>
        <div className="truncate" title={instance.model}>
          <span className="text-foreground/40">model</span> {instance.model || "—"}
        </div>
        <div>
          <span className="text-foreground/40">up</span> {formatUptime(instance.startedAt, instance.exitedAt)}
        </div>
        {instance.accountLabel ? (
          <div className="truncate col-span-2" title={instance.accountLabel}>
            <span className="text-foreground/40">acct</span> {instance.accountLabel}
            {instance.oauthMasked ? <span className="text-foreground/30"> · {instance.oauthMasked}</span> : null}
          </div>
        ) : null}
        {instance.planMode !== null ? (
          <div>
            <span className="text-foreground/40">plan</span> {instance.planMode ? "on" : "off"}
          </div>
        ) : null}
        {instance.smokeTest ? (
          <div>
            <span className="text-foreground/40">smoke</span>{" "}
            <span style={{ color: instance.smokeTest === "pass" ? PHASE_COLOR.ready : PHASE_COLOR.exited }}>
              {instance.smokeTest}
            </span>
          </div>
        ) : null}
        {instance.rssBytes !== null ? (
          <div className="truncate col-span-2" title="Resident memory (current · peak across session)">
            <span className="text-foreground/40">mem</span> {formatBytes(instance.rssBytes)}
            {instance.rssPeakBytes !== null && instance.rssPeakBytes > instance.rssBytes ? (
              <span className="text-foreground/30"> · peak {formatBytes(instance.rssPeakBytes)}</span>
            ) : null}
          </div>
        ) : null}
        {instance.cpuPercent !== null ? (
          <div className="truncate col-span-2" title="CPU usage % across process tree (current · peak; >100% = multi-core)">
            <span className="text-foreground/40">cpu</span> {formatPercent(instance.cpuPercent)}
            {instance.cpuPeakPercent !== null && instance.cpuPeakPercent > instance.cpuPercent ? (
              <span className="text-foreground/30"> · peak {formatPercent(instance.cpuPeakPercent)}</span>
            ) : null}
          </div>
        ) : null}
      </div>

      {instance.phase !== "exited" ? (
        <div className="flex items-center gap-1.5 pt-1">
          <button
            type="button"
            onClick={() => onOpenChat(instance.chatId)}
            className="text-[10px] font-mono px-2 py-1 rounded-md border border-border/60 hover:bg-muted/40 transition-colors"
          >
            open
          </button>
          <button
            type="button"
            onClick={() => onCancel(instance.chatId)}
            className="text-[10px] font-mono px-2 py-1 rounded-md border border-border/60 hover:bg-muted/40 transition-colors"
          >
            cancel
          </button>
          <button
            type="button"
            onClick={handleKillClick}
            onBlur={() => setConfirmKill(false)}
            className="text-[10px] font-mono px-2 py-1 rounded-md border transition-colors ml-auto"
            style={{
              borderColor: confirmKill ? "var(--destructive)" : "var(--border)",
              color: confirmKill ? "var(--destructive)" : undefined,
            }}
            aria-label={confirmKill ? "Confirm kill" : "Kill PTY process"}
          >
            {confirmKill ? "confirm kill?" : "kill"}
          </button>
        </div>
      ) : (
        <div className="text-[10px] font-mono text-muted-foreground pt-1">
          exited{instance.exitCode !== null ? ` · code ${instance.exitCode}` : ""}
        </div>
      )}
    </div>
  )
}

interface ViewProps {
  instances: readonly PtyInstanceState[]
  liveCount: number
  open: boolean
  onOpenChange: (open: boolean) => void
  onOpenChat: (chatId: string) => void
  onCancel: (chatId: string) => void
  onKill: (chatId: string) => void
}

export function PtyInstancesIndicatorView({
  instances,
  liveCount,
  open,
  onOpenChange,
  onOpenChat,
  onCancel,
  onKill,
}: ViewProps) {
  const hasActive = liveCount > 0
  const tooltipLabel = hasActive
    ? `${liveCount} claude PTY instance${liveCount === 1 ? "" : "s"}`
    : "No live PTY instances"

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <button
              type="button"
              aria-label={tooltipLabel}
              className="inline-flex items-center gap-1.5 px-1.5 h-9 rounded-md hover:bg-transparent focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
            >
              <span
                aria-hidden
                className="inline-block w-[7px] h-[7px] rounded-full flex-shrink-0"
                style={{ backgroundColor: hasActive ? PHASE_COLOR.ready : "var(--muted-foreground)" }}
              />
              <span
                className="text-xs font-mono font-medium tabular-nums leading-none"
                style={{ color: hasActive ? PHASE_COLOR.ready : "var(--muted-foreground)" }}
              >
                pty {liveCount}
              </span>
            </button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="bottom">{tooltipLabel}</TooltipContent>
      </Tooltip>

      <PopoverContent align="end" sideOffset={8} className="w-[420px] p-3">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-xs font-mono uppercase tracking-wider text-foreground/60">
            claude pty instances
          </h3>
          <span className="text-[10px] font-mono text-muted-foreground tabular-nums">
            {liveCount} live · {instances.length} tracked
          </span>
        </div>
        {instances.length === 0 ? (
          <div className="text-xs text-muted-foreground text-center py-6 font-mono">
            no instances yet
          </div>
        ) : (
          <div className="flex flex-col gap-2 max-h-[60vh] overflow-y-auto">
            {instances.map((instance) => (
              <PtyInstanceRow
                key={instance.chatId}
                instance={instance}
                onOpenChat={onOpenChat}
                onCancel={onCancel}
                onKill={onKill}
              />
            ))}
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}

interface ConnectedProps {
  socket?: KannaSocket
  onOpenChat?: (chatId: string) => void
}

export function PtyInstancesIndicator({ socket, onOpenChat }: ConnectedProps) {
  const instances = usePtyInstances()
  const liveCount = usePtyLiveCount()
  const open = usePtyPopoverOpen()

  const onOpenChange = useCallback((nextOpen: boolean) => {
    const store = usePtyInstancesStore.getState()
    if (nextOpen) store.openPopover()
    else store.closePopover()
  }, [])

  const handleOpenChat = useCallback(
    (chatId: string) => {
      usePtyInstancesStore.getState().closePopover()
      onOpenChat?.(chatId)
    },
    [onOpenChat],
  )

  const handleCancel = useCallback(
    (chatId: string) => {
      if (!socket) return
      const cmd: ClientCommand = { type: "pty.cancel", chatId }
      void socket.command(cmd).catch(() => {})
    },
    [socket],
  )

  const handleKill = useCallback(
    (chatId: string) => {
      if (!socket) return
      const cmd: ClientCommand = { type: "pty.kill", chatId }
      void socket.command(cmd).catch(() => {})
    },
    [socket],
  )

  const stableInstances = useMemo(() => instances, [instances])

  return (
    <PtyInstancesIndicatorView
      instances={stableInstances}
      liveCount={liveCount}
      open={open}
      onOpenChange={onOpenChange}
      onOpenChat={handleOpenChat}
      onCancel={handleCancel}
      onKill={handleKill}
    />
  )
}
