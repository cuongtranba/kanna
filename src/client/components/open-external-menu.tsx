import { useCallback, useEffect, useMemo } from "react"
import { OpenExternalSelectStore } from "./OpenExternalSelect.store"
import { ChevronDown } from "lucide-react"
import type { EditorOpenSettings, EditorPreset, OpenExternalAction } from "../../shared/protocol"
import { isEditorPreset } from "../../shared/types"
import { oneOf } from "../../shared/vocab"
import { getDefaultEditorCommandTemplate, getEditorPresetLabel } from "../stores/terminalPreferencesStore"
import { DefaultAppIcon, EDITOR_OPTIONS, EditorIcon, FinderIcon, FolderFallbackIcon, PreviewIcon, TerminalIcon } from "./editor-icons"
import { HotkeyTooltip, HotkeyTooltipContent, HotkeyTooltipTrigger } from "./ui/tooltip"
import { Button } from "./ui/button"
import { Spinner } from "./ui/spinner"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "./ui/select"
import { ContextMenuContent, ContextMenuItem } from "./ui/context-menu"
import type { StoragePort } from "../ports/storagePort"
import { localStorageAdapter } from "../adapters/storage.adapter"

const FIXED_OPEN_APPS = ["finder", "terminal", "preview", "default"] as const
type FixedOpenApp = (typeof FIXED_OPEN_APPS)[number]
const isFixedOpenApp = oneOf(FIXED_OPEN_APPS)

export type OpenAppValue = FixedOpenApp | `editor:${EditorPreset}`
export type OpenAppTarget = { kind: FixedOpenApp } | { kind: "editor"; preset: EditorPreset }

const EDITOR_VALUE_PREFIX = "editor:"
const OPEN_SELECT_STORAGE_KEY = "kanna:last-open-external"
const OPEN_APP_MENU_ITEM_CLASS_NAME = "py-2 pl-2 pr-8"
const OPEN_APP_CONTEXT_MENU_ITEM_CLASS_NAME = "rounded-md text-sm font-normal focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
const OPEN_APP_MENU_ROW_CLASS_NAME = "flex items-center gap-3"
const OPEN_APP_MENU_ICON_CLASS_NAME = "h-5 w-5 shrink-0"

const OPEN_EXTERNAL_ACTION: Record<FixedOpenApp, OpenExternalAction> = {
  finder: "open_finder",
  terminal: "open_terminal",
  preview: "open_preview",
  default: "open_default",
}

export function parseOpenAppValue(value: string | null): OpenAppTarget | null {
  if (value === null) return null
  if (isFixedOpenApp(value)) return { kind: value }
  if (!value.startsWith(EDITOR_VALUE_PREFIX)) return null
  const preset = value.slice(EDITOR_VALUE_PREFIX.length)
  return isEditorPreset(preset) ? { kind: "editor", preset } : null
}

export function formatOpenAppValue(target: OpenAppTarget): OpenAppValue {
  return target.kind === "editor" ? `editor:${target.preset}` : target.kind
}

function editorTarget(preset: EditorPreset): OpenAppTarget {
  return { kind: "editor", preset }
}

function isSameTarget(a: OpenAppTarget, b: OpenAppTarget): boolean {
  return formatOpenAppValue(a) === formatOpenAppValue(b)
}

function OpenAppMenuItemContent({
  target,
  label,
  isMac,
}: {
  target: OpenAppTarget
  label: string
  isMac: boolean
}) {
  return (
    <span className={OPEN_APP_MENU_ROW_CLASS_NAME}>
      <OpenAppIcon target={target} isMac={isMac} className={OPEN_APP_MENU_ICON_CLASS_NAME} />
      <span>{label}</span>
    </span>
  )
}

export function getEditorSettings(preset: EditorPreset, customTemplate?: string): EditorOpenSettings {
  return {
    preset,
    commandTemplate: preset === "custom"
      ? customTemplate?.trim() || getDefaultEditorCommandTemplate(preset)
      : getDefaultEditorCommandTemplate(preset),
  }
}

export function getOpenAppLabel(target: OpenAppTarget, isMac: boolean) {
  switch (target.kind) {
    case "finder":
      return isMac ? "Finder" : "Folder"
    case "terminal":
      return "Terminal"
    case "preview":
      return "Preview"
    case "default":
      return "Default App"
    case "editor":
      return getEditorPresetLabel(target.preset)
  }
}

export function OpenAppIcon({ target, isMac, className }: { target: OpenAppTarget; isMac: boolean; className?: string }) {
  switch (target.kind) {
    case "finder":
      return isMac ? <FinderIcon className={className} /> : <FolderFallbackIcon className={className} />
    case "terminal":
      return <TerminalIcon className={className} />
    case "preview":
      return <PreviewIcon className={className} />
    case "default":
      return <DefaultAppIcon className={className} />
    case "editor":
      return <EditorIcon preset={target.preset} className={className} />
  }
}

type OpenAppItem = { value: OpenAppValue; target: OpenAppTarget; label: string }

function openAppItem(target: OpenAppTarget, isMac: boolean): OpenAppItem {
  return { value: formatOpenAppValue(target), target, label: getOpenAppLabel(target, isMac) }
}

export function getOpenAppItems({
  editorPreset,
  isMac,
  includeFinder = true,
  includeTerminal = false,
  includePreview = false,
  includeDefault = false,
  menuKind = "context",
}: {
  editorPreset: EditorPreset
  isMac: boolean
  includeFinder?: boolean
  includeTerminal?: boolean
  includePreview?: boolean
  includeDefault?: boolean
  menuKind?: "context" | "navbar"
}): Array<OpenAppItem> {
  const fixedItem = (kind: FixedOpenApp, included: boolean) => (included ? [openAppItem({ kind }, isMac)] : [])
  const editorItems = EDITOR_OPTIONS
    .filter((option) => option.value !== "custom" || editorPreset === "custom")
    .map((option) => openAppItem(editorTarget(option.value), isMac))
  const defaultEditorValue = formatOpenAppValue(editorTarget(editorPreset))
  const defaultEditorItems = editorItems.filter((item) => item.value === defaultEditorValue)
  const otherEditorItems = editorItems.filter((item) => item.value !== defaultEditorValue)
  if (menuKind === "navbar") {
    return [
      ...defaultEditorItems,
      ...fixedItem("finder", includeFinder),
      ...fixedItem("terminal", includeTerminal),
      ...otherEditorItems,
    ]
  }
  return [
    ...defaultEditorItems,
    ...otherEditorItems,
    ...fixedItem("preview", includePreview && isMac),
    ...fixedItem("finder", includeFinder),
    ...fixedItem("terminal", includeTerminal),
    ...fixedItem("default", includeDefault),
  ]
}

export function openAppTarget(args: {
  target: OpenAppTarget
  editorCommandTemplate?: string
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
}) {
  if (args.target.kind === "editor") {
    args.onOpenExternal("open_editor", getEditorSettings(args.target.preset, args.editorCommandTemplate))
    return
  }
  args.onOpenExternal(OPEN_EXTERNAL_ACTION[args.target.kind])
}

export interface OpenExternalSelectPorts {
  storage?: StoragePort
}

function OpenExternalSelectInner({
  isMac,
  editorPreset,
  editorCommandTemplate,
  finderShortcut,
  editorShortcut,
  onOpenExternal,
  pending = false,
  ports,
}: {
  isMac: boolean
  editorPreset: EditorPreset
  editorCommandTemplate?: string
  finderShortcut?: string[]
  editorShortcut?: string[]
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
  pending?: boolean
  ports?: OpenExternalSelectPorts
}) {
  const storage = ports?.storage ?? localStorageAdapter
  const lastTarget = OpenExternalSelectStore.useScopedStore((s) => s.lastTarget)
  const setLastTarget = OpenExternalSelectStore.useScopedStore((s) => s.setLastTarget)

  useEffect(() => {
    setLastTarget(parseOpenAppValue(storage.getItem(OPEN_SELECT_STORAGE_KEY)) ?? editorTarget(editorPreset))
  }, [editorPreset, setLastTarget, storage])

  const items = useMemo(() => getOpenAppItems({
    editorPreset,
    isMac,
    includeFinder: true,
    includeTerminal: true,
    menuKind: "navbar",
  }), [editorPreset, isMac])

  function handleOpenTarget(target: OpenAppTarget) {
    setLastTarget(target)
    storage.setItem(OPEN_SELECT_STORAGE_KEY, formatOpenAppValue(target))
    openAppTarget({ target, editorCommandTemplate, onOpenExternal })
  }

  let tooltipShortcut: typeof finderShortcut | undefined
  if (lastTarget.kind === "finder") {
    tooltipShortcut = finderShortcut
  } else if (isSameTarget(lastTarget, editorTarget(editorPreset))) {
    tooltipShortcut = editorShortcut
  } else {
    tooltipShortcut = undefined
  }

  return (
    <div className="grid grid-cols-[1fr_auto]">
      <HotkeyTooltip>
        <HotkeyTooltipTrigger asChild>
          <Button
            variant="ghost"
            size="none"
            onClick={() => handleOpenTarget(lastTarget)}
            disabled={pending}
            aria-busy={pending || undefined}
            title={`Open in ${getOpenAppLabel(lastTarget, isMac)}`}
            className="border-0 !pl-2.5 !pr-1 hover:!border-border/0 hover:!bg-transparent"
          >
            {pending
              ? <Spinner className="size-6 p-1" />
              : <OpenAppIcon target={lastTarget} isMac={isMac} className="size-6" />}
          </Button>
        </HotkeyTooltipTrigger>
        <HotkeyTooltipContent
          side="bottom"
          shortcut={tooltipShortcut}
        />
      </HotkeyTooltip>
      <Select disabled={pending} value={undefined} onValueChange={(value) => handleOpenTarget(parseOpenAppValue(value) ?? lastTarget)}>
        <SelectTrigger
          aria-label="Choose open destination"
          className="!pl-1 !pr-2.5 border-0 bg-transparent hover:bg-transparent focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        >
          <span className="flex items-center justify-center">
            <ChevronDown className="h-4 w-4 opacity-60" />
          </span>
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} className={OPEN_APP_MENU_ITEM_CLASS_NAME}>
                <OpenAppMenuItemContent target={item.target} label={item.label} isMac={isMac} />
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

export function OpenExternalSelect({
  isMac,
  editorPreset,
  editorCommandTemplate,
  finderShortcut,
  editorShortcut,
  onOpenExternal,
  pending,
  ports,
}: {
  isMac: boolean
  editorPreset: EditorPreset
  editorCommandTemplate?: string
  finderShortcut?: string[]
  editorShortcut?: string[]
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
  pending?: boolean
  ports?: OpenExternalSelectPorts
}) {
  return (
    <OpenExternalSelectStore.Provider init={{ initialTarget: editorTarget(editorPreset) }}>
      <OpenExternalSelectInner
        isMac={isMac}
        editorPreset={editorPreset}
        editorCommandTemplate={editorCommandTemplate}
        finderShortcut={finderShortcut}
        editorShortcut={editorShortcut}
        onOpenExternal={onOpenExternal}
        pending={pending}
        ports={ports}
      />
    </OpenExternalSelectStore.Provider>
  )
}

export function OpenExternalContextMenuContent({
  isMac,
  editorPreset,
  editorCommandTemplate,
  includeFinder = true,
  includeTerminal = false,
  includePreview = false,
  includeDefault = false,
  onOpenExternal,
}: {
  isMac: boolean
  editorPreset: EditorPreset
  editorCommandTemplate?: string
  includeFinder?: boolean
  includeTerminal?: boolean
  includePreview?: boolean
  includeDefault?: boolean
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
}) {
  const items = getOpenAppItems({
    editorPreset,
    isMac,
    includeFinder,
    includeTerminal,
    includePreview,
    includeDefault,
  })

  const handleSelectApp = useCallback((event: Event, target: OpenAppTarget) => {
    event.preventDefault()
    openAppTarget({ target, editorCommandTemplate, onOpenExternal })
  }, [editorCommandTemplate, onOpenExternal])

  return (
    <ContextMenuContent className="rounded-lg p-1">
      {items.map((item) => (
        <ContextMenuItem
          key={item.value}
          className={`${OPEN_APP_MENU_ITEM_CLASS_NAME} ${OPEN_APP_CONTEXT_MENU_ITEM_CLASS_NAME}`}
          onSelect={(event) => handleSelectApp(event, item.target)}
        >
          <OpenAppMenuItemContent target={item.target} label={item.label} isMac={isMac} />
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  )
}
