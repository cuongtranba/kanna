import { memo, useCallback, useMemo, type ChangeEvent } from "react"
import { Clock } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover"
import { snoozeActionKey, snoozeInboxThreads } from "../lib/inboxActions"
import { formatSnoozeUntil, parseSnoozeInput, snoozePresets, type SnoozePreset } from "../lib/inboxSnooze"
import {
  selectSnoozeCustom,
  selectSnoozeMenu,
  selectSnoozeOpenedAt,
  useInboxStore,
  type SnoozeMenuId,
} from "../stores/inboxStore"
import { usePendingAction } from "../stores/pendingActionsStore"
import { InboxShortcutHint } from "./InboxShortcutHint"
import { useOptionalKannaSocket } from "./KannaSocketProvider"

interface Props {
  menu: SnoozeMenuId
  threadIds: readonly string[]
  onSnoozed: () => void
}

interface PresetRowProps {
  preset: SnoozePreset
  openedAt: number
  disabled: boolean
  onPick: (until: number) => void
}

function PresetRowImpl({ preset, openedAt, disabled, onPick }: PresetRowProps) {
  const { until } = preset
  const handleClick = useCallback(() => onPick(until), [onPick, until])
  return (
    <Button variant="ghost" size="sm" className="w-full justify-between gap-4 font-normal text-foreground" disabled={disabled} onClick={handleClick}>
      <span>{preset.label}</span>
      <span className="text-xs tabular-nums text-muted-foreground">{formatSnoozeUntil(until, openedAt)}</span>
    </Button>
  )
}

const PresetRow = memo(PresetRowImpl)

function SnoozeTrigger({ menu }: { menu: SnoozeMenuId }) {
  const button = (
    <PopoverTrigger asChild>
      <Button variant="secondary" size="sm">
        <Clock className={menu === "detail" ? "h-4 w-4 md:mr-1.5" : "mr-1.5 h-4 w-4"} aria-hidden="true" />
        <span className={menu === "detail" ? "max-md:sr-only" : undefined}>Snooze</span>
      </Button>
    </PopoverTrigger>
  )
  if (menu === "bulk") return button
  return (
    <InboxShortcutHint label="Snooze" action="inboxSnoozeThread">
      {button}
    </InboxShortcutHint>
  )
}

export function InboxSnoozeMenu({ menu, threadIds, onSnoozed }: Props) {
  const socket = useOptionalKannaSocket()
  const openMenu = useInboxStore(selectSnoozeMenu)
  const openedAt = useInboxStore(selectSnoozeOpenedAt)
  const custom = useInboxStore(selectSnoozeCustom)
  const pending = usePendingAction(snoozeActionKey(threadIds))
  const presets = useMemo(() => snoozePresets(openedAt), [openedAt])
  const customUntil = parseSnoozeInput(custom, openedAt)

  const handleOpenChange = useCallback((open: boolean) => useInboxStore.getState().setSnoozeMenu(open ? menu : null), [menu])
  const handlePick = useCallback(
    (until: number) => {
      snoozeInboxThreads(socket, threadIds, until, () => {
        useInboxStore.getState().setSnoozeMenu(null)
        onSnoozed()
      })
    },
    [onSnoozed, socket, threadIds],
  )
  const handleCustomChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => useInboxStore.getState().setSnoozeCustom(event.target.value),
    [],
  )
  const handleCustomSnooze = useCallback(() => {
    if (customUntil !== null) handlePick(customUntil)
  }, [customUntil, handlePick])

  return (
    <Popover open={openMenu === menu} onOpenChange={handleOpenChange}>
      <SnoozeTrigger menu={menu} />
      <PopoverContent align="end" className="w-72 space-y-1 p-2">
        {presets.map((preset) => (
          <PresetRow key={preset.id} preset={preset} openedAt={openedAt} disabled={pending} onPick={handlePick} />
        ))}
        <div className="space-y-2 border-t border-border px-1 pt-3">
          <label htmlFor={`inbox-snooze-custom-${menu}`} className="block text-xs font-medium text-muted-foreground">
            Pick a time
          </label>
          <Input
            id={`inbox-snooze-custom-${menu}`}
            type="datetime-local"
            className="tabular-nums"
            value={custom}
            onChange={handleCustomChange}
          />
          <Button size="sm" className="w-full" disabled={customUntil === null} pending={pending} onClick={handleCustomSnooze}>
            {customUntil === null ? "Snooze" : `Snooze until ${formatSnoozeUntil(customUntil, openedAt)}`}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
