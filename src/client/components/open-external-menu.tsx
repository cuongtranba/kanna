import { useEffect, useMemo } from "react"
import { OpenExternalSelectStore } from "./OpenExternalSelect.store"
import { ChevronDown } from "lucide-react"
import type { EditorOpenSettings, EditorPreset, OpenExternalAction } from "../../shared/protocol"
import { isEditorPreset } from "../../shared/types"
import { getDefaultEditorCommandTemplate } from "../stores/terminalPreferencesStore"
import { DefaultAppIcon, EDITOR_OPTIONS, EditorIcon, FinderIcon, FolderFallbackIcon, PreviewIcon, TerminalIcon } from "./editor-icons"
import { HotkeyTooltip, HotkeyTooltipContent, HotkeyTooltipTrigger } from "./ui/tooltip"
import { Button } from "./ui/button"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "./ui/select"
import { ContextMenuContent, ContextMenuItem } from "./ui/context-menu"

export type OpenAppValue = "finder" | "terminal" | "preview" | "default" | `editor:${EditorPreset}`

const OPEN_SELECT_STORAGE_KEY = "kanna:last-open-external"
const OPEN_APP_MENU_ITEM_CLASS_NAME = "py-2 pl-2 pr-8"
const OPEN_APP_CONTEXT_MENU_ITEM_CLASS_NAME = "rounded-md text-sm font-normal focus:bg-accent focus:text-accent-foreground hover:bg-accent hover:text-accent-foreground"
const OPEN_APP_MENU_ROW_CLASS_NAME = "flex items-center gap-3"
const OPEN_APP_MENU_ICON_CLASS_NAME = "h-5 w-5 shrink-0"

function OpenAppMenuItemContent({
  value,
  label,
  isMac,
}: {
  value: OpenAppValue
  label: string
  isMac: boolean
}) {
  return (
    <span className={OPEN_APP_MENU_ROW_CLASS_NAME}>
      <OpenAppIcon value={value} isMac={isMac} className={OPEN_APP_MENU_ICON_CLASS_NAME} />
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

export function getOpenAppLabel(value: OpenAppValue, isMac: boolean) {
  if (value === "finder") return isMac ? "Finder" : "Folder"
  if (value === "terminal") return "Terminal"
  if (value === "preview") return "Preview"
  if (value === "default") return "Default App"
  const preset = value.slice("editor:".length)
  if (preset === "vscode") return "VS Code"
  return EDITOR_OPTIONS.find((option) => option.value === preset)?.label ?? "Editor"
}

export function OpenAppIcon({ value, isMac, className }: { value: OpenAppValue; isMac: boolean; className?: string }) {
  if (value === "finder") {
    return isMac ? <FinderIcon className={className} /> : <FolderFallbackIcon className={className} />
  }
  if (value === "terminal") {
    return <TerminalIcon className={className} />
  }
  if (value === "preview") {
    return <PreviewIcon className={className} />
  }
  if (value === "default") {
    return <DefaultAppIcon className={className} />
  }
  const preset = value.slice("editor:".length)
  const resolvedPreset = EDITOR_OPTIONS.find((o) => o.value === preset)?.value ?? "vscode"
  return <EditorIcon preset={resolvedPreset} className={className} />
}

function normalizeOpenAppValue(value: string | null, fallback: OpenAppValue): OpenAppValue {
  if (value === "finder" || value === "terminal" || value === "preview" || value === "default") return value
  if (value?.startsWith("editor:")) {
    const preset = value.slice("editor:".length)
    if (isEditorPreset(preset)) {
      const v: OpenAppValue = `editor:${preset}`
      return v
    }
  }
  return fallback
}

type OpenAppItem = { value: OpenAppValue; label: string }

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
  const finderItem: OpenAppItem = { value: "finder", label: isMac ? "Finder" : "Folder" }
  const terminalItem: OpenAppItem = { value: "terminal", label: "Terminal" }
  const previewItem: OpenAppItem = { value: "preview", label: "Preview" }
  const defaultItem: OpenAppItem = { value: "default", label: "Default App" }
  const customEditorItem: OpenAppItem = { value: "editor:custom", label: "Custom" }

  const editorItems: Array<OpenAppItem> = [
    { value: "editor:cursor", label: "Cursor" },
    { value: "editor:xcode", label: "Xcode" },
    { value: "editor:windsurf", label: "Windsurf" },
    ...(editorPreset === "custom" ? [customEditorItem] : []),
  ]
  const defaultEditorValue: OpenAppValue = `editor:${editorPreset}`
  const sortedEditorItems = [
    ...editorItems.filter((item) => item.value === defaultEditorValue),
    ...editorItems.filter((item) => item.value !== defaultEditorValue),
  ]
  if (menuKind === "navbar") {
    return [
      ...sortedEditorItems.filter((item) => item.value === defaultEditorValue),
      ...(includeFinder ? [finderItem] : []),
      ...(includeTerminal ? [terminalItem] : []),
      ...sortedEditorItems.filter((item) => item.value !== defaultEditorValue),
    ]
  }
  return [
    ...sortedEditorItems,
    ...(includePreview && isMac ? [previewItem] : []),
    ...(includeFinder ? [finderItem] : []),
    ...(includeTerminal ? [terminalItem] : []),
    ...(includeDefault ? [defaultItem] : []),
  ]
}

export function openAppValue(args: {
  value: OpenAppValue
  editorCommandTemplate?: string
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
}) {
  if (args.value === "finder") {
    args.onOpenExternal("open_finder")
    return
  }
  if (args.value === "terminal") {
    args.onOpenExternal("open_terminal")
    return
  }
  if (args.value === "preview") {
    args.onOpenExternal("open_preview")
    return
  }
  if (args.value === "default") {
    args.onOpenExternal("open_default")
    return
  }
  const rawPreset = args.value.slice("editor:".length)
  const preset = EDITOR_OPTIONS.find((o) => o.value === rawPreset)?.value ?? "vscode"
  args.onOpenExternal("open_editor", getEditorSettings(preset, args.editorCommandTemplate))
}

function OpenExternalSelectInner({
  isMac,
  editorPreset,
  editorCommandTemplate,
  finderShortcut,
  editorShortcut,
  onOpenExternal,
}: {
  isMac: boolean
  editorPreset: EditorPreset
  editorCommandTemplate?: string
  finderShortcut?: string[]
  editorShortcut?: string[]
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
}) {
  const fallbackValue: OpenAppValue = `editor:${editorPreset}`
  const lastValue = OpenExternalSelectStore.useScopedStore((s) => s.lastValue)
  const setLastValue = OpenExternalSelectStore.useScopedStore((s) => s.setLastValue)

  useEffect(() => {
    setLastValue(normalizeOpenAppValue(window.localStorage.getItem(OPEN_SELECT_STORAGE_KEY), fallbackValue))
  }, [fallbackValue, setLastValue])

  const items = useMemo(() => getOpenAppItems({
    editorPreset,
    isMac,
    includeFinder: true,
    includeTerminal: true,
    menuKind: "navbar",
  }), [editorPreset, isMac])

  function handleOpenValue(value: OpenAppValue) {
    setLastValue(value)
    window.localStorage.setItem(OPEN_SELECT_STORAGE_KEY, value)
    openAppValue({ value, editorCommandTemplate, onOpenExternal })
  }

  let tooltipShortcut: typeof finderShortcut | undefined
  if (lastValue === "finder") {
    tooltipShortcut = finderShortcut
  } else if (lastValue === `editor:${editorPreset}`) {
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
            onClick={() => handleOpenValue(lastValue)}
            title={`Open in ${getOpenAppLabel(lastValue, isMac)}`}
            className="border-0 !pl-2.5 !pr-1 hover:!border-border/0 hover:!bg-transparent"
          >
            <OpenAppIcon value={lastValue} isMac={isMac} className="size-6" />
          </Button>
        </HotkeyTooltipTrigger>
        <HotkeyTooltipContent
          side="bottom"
          shortcut={tooltipShortcut}
        />
      </HotkeyTooltip>
      <Select value={undefined} onValueChange={(value) => handleOpenValue(normalizeOpenAppValue(value, lastValue))}>
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
                <OpenAppMenuItemContent value={item.value} label={item.label} isMac={isMac} />
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
}: {
  isMac: boolean
  editorPreset: EditorPreset
  editorCommandTemplate?: string
  finderShortcut?: string[]
  editorShortcut?: string[]
  onOpenExternal: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
}) {
  const initialValue: OpenAppValue = `editor:${editorPreset}`
  return (
    <OpenExternalSelectStore.Provider init={{ initialValue }}>
      <OpenExternalSelectInner
        isMac={isMac}
        editorPreset={editorPreset}
        editorCommandTemplate={editorCommandTemplate}
        finderShortcut={finderShortcut}
        editorShortcut={editorShortcut}
        onOpenExternal={onOpenExternal}
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

  return (
    <ContextMenuContent className="rounded-lg p-1">
      {items.map((item) => (
        <ContextMenuItem
          key={item.value}
          className={`${OPEN_APP_MENU_ITEM_CLASS_NAME} ${OPEN_APP_CONTEXT_MENU_ITEM_CLASS_NAME}`}
          onSelect={(event) => {
            event.preventDefault()
            openAppValue({ value: item.value, editorCommandTemplate, onOpenExternal })
          }}
        >
          <OpenAppMenuItemContent value={item.value} label={item.label} isMac={isMac} />
        </ContextMenuItem>
      ))}
    </ContextMenuContent>
  )
}
