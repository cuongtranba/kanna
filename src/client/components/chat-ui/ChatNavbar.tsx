import { useEffect, useMemo, useState } from "react"
import { ChevronDown, Flower, GitBranch, Loader2, Menu, PanelLeft, PanelRight, Share, Share2, SquarePen, Terminal, UserRound, UserRoundPlus } from "lucide-react"
import type { EditorOpenSettings, EditorPreset } from "../../../shared/protocol"
import { Button } from "../ui/button"
import { CardHeader } from "../ui/card"
import { HotkeyTooltip, HotkeyTooltipContent, HotkeyTooltipTrigger } from "../ui/tooltip"
import { cn } from "../../lib/utils"
import { getDefaultEditorCommandTemplate } from "../../stores/terminalPreferencesStore"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger } from "../ui/select"
import { EDITOR_OPTIONS, EditorIcon, FinderIcon, FolderFallbackIcon, TerminalIcon } from "../editor-icons"

type OpenExternalAction = "open_finder" | "open_terminal" | "open_editor"
type OpenSelectValue = "finder" | "terminal" | `editor:${EditorPreset}`

const OPEN_SELECT_STORAGE_KEY = "kanna:last-open-external"

function getEditorSettings(preset: EditorPreset, customTemplate?: string): EditorOpenSettings {
  return {
    preset,
    commandTemplate: preset === "custom"
      ? customTemplate?.trim() || getDefaultEditorCommandTemplate(preset)
      : getDefaultEditorCommandTemplate(preset),
  }
}

function getOpenSelectLabel(value: OpenSelectValue, isMac: boolean) {
  if (value === "finder") return isMac ? "Finder" : "Folder"
  if (value === "terminal") return "Terminal"
  const preset = value.replace("editor:", "") as EditorPreset
  if (preset === "vscode") return "VS Code"
  return EDITOR_OPTIONS.find((option) => option.value === preset)?.label ?? "Editor"
}

function OpenSelectIcon({ value, isMac, className }: { value: OpenSelectValue; isMac: boolean; className?: string }) {
  if (value === "finder") {
    return isMac ? <FinderIcon className={className} /> : <FolderFallbackIcon className={className} />
  }
  if (value === "terminal") {
    return <TerminalIcon className={className} />
  }
  return <EditorIcon preset={value.replace("editor:", "") as EditorPreset} className={className} />
}

function normalizeOpenSelectValue(value: string | null, fallback: OpenSelectValue): OpenSelectValue {
  if (value === "finder" || value === "terminal") return value
  if (value?.startsWith("editor:")) {
    const preset = value.slice("editor:".length)
    if (preset === "vscode" || EDITOR_OPTIONS.some((option) => option.value === preset)) {
      return value as OpenSelectValue
    }
  }
  return fallback
}

function OpenExternalSelect({
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
  const fallbackValue = `editor:${editorPreset}` as OpenSelectValue
  const [lastValue, setLastValue] = useState<OpenSelectValue>(fallbackValue)

  useEffect(() => {
    setLastValue(normalizeOpenSelectValue(window.localStorage.getItem(OPEN_SELECT_STORAGE_KEY), fallbackValue))
  }, [fallbackValue])

  const items = useMemo<Array<{ value: OpenSelectValue; label: string }>>(() => {
    const editorItems: Array<{ value: OpenSelectValue; label: string }> = [
      { value: "editor:cursor", label: "Cursor" },
      { value: "editor:xcode", label: "Xcode" },
      { value: "editor:windsurf", label: "Windsurf" },
      ...(editorPreset === "custom" ? [{ value: "editor:custom" as OpenSelectValue, label: "Custom" }] : []),
    ]
    const defaultEditorValue = `editor:${editorPreset}` as OpenSelectValue
    const sortedEditorItems = [
      ...editorItems.filter((item) => item.value === defaultEditorValue),
      ...editorItems.filter((item) => item.value !== defaultEditorValue),
    ]
    return [
      ...sortedEditorItems,
      { value: "finder", label: isMac ? "Finder" : "Folder" },
      { value: "terminal", label: "Terminal" },
    ]
  }, [editorPreset, isMac])

  function openValue(value: OpenSelectValue) {
    setLastValue(value)
    window.localStorage.setItem(OPEN_SELECT_STORAGE_KEY, value)
    if (value === "finder") {
      onOpenExternal("open_finder")
      return
    }
    if (value === "terminal") {
      onOpenExternal("open_terminal")
      return
    }
    const preset = value.replace("editor:", "") as EditorPreset
    onOpenExternal("open_editor", getEditorSettings(preset, editorCommandTemplate))
  }

  return (
    <div className="grid grid-cols-[1fr_auto]">
      <HotkeyTooltip>
        <HotkeyTooltipTrigger asChild>
          <Button
            variant="ghost"
            size="none"
            onClick={() => openValue(lastValue)}
            title={`Open in ${getOpenSelectLabel(lastValue, isMac)}`}
            className="border-0 !pl-2.5 !pr-1 hover:!border-border/0 hover:!bg-transparent"
          >
            <OpenSelectIcon value={lastValue} isMac={isMac} className="size-6" />
          </Button>
        </HotkeyTooltipTrigger>
        <HotkeyTooltipContent
          side="bottom"
          shortcut={lastValue === "finder" ? finderShortcut : lastValue === `editor:${editorPreset}` ? editorShortcut : undefined}
        />
      </HotkeyTooltip>
      <Select value={undefined} onValueChange={(value) => openValue(value as OpenSelectValue)}>
        <SelectTrigger
          aria-label="Choose open destination"
          className="!pl-1 !pr-2.5 border-0 bg-transparent hover:bg-transparent focus:ring-0 focus:ring-offset-0 [&>svg]:hidden"
        >
          <span className="flex items-center justify-center">
            <ChevronDown className="h-4 w-4 opacity-60" />
          </span>
        </SelectTrigger>
        <SelectContent align="end" className="min-w-[210px]">
          <SelectGroup>
            {items.map((item) => (
              <SelectItem key={item.value} value={item.value} className="py-2 pl-2 pr-8">
                <span className="flex items-center gap-3">
                  <OpenSelectIcon value={item.value} isMac={isMac} className="h-5 w-5 shrink-0" />
                  <span>{item.label}</span>
                </span>
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  )
}

interface Props {
  sidebarCollapsed: boolean
  onOpenSidebar: () => void
  onExpandSidebar: () => void
  onNewChat: () => void
  localPath?: string
  embeddedTerminalVisible?: boolean
  onToggleEmbeddedTerminal?: () => void
  rightSidebarVisible?: boolean
  onToggleRightSidebar?: () => void
  onOpenExternal?: (action: OpenExternalAction, editor?: EditorOpenSettings) => void
  onExportTranscript?: () => void
  canExportTranscript?: boolean
  isExportingTranscript?: boolean
  editorPreset?: EditorPreset
  editorCommandTemplate?: string
  platform?: NodeJS.Platform
  finderShortcut?: string[]
  editorShortcut?: string[]
  terminalShortcut?: string[]
  rightSidebarShortcut?: string[]
  branchName?: string
  hasGitRepo?: boolean
  gitStatus?: "unknown" | "ready" | "no_repo"
}

export function ChatNavbar({
  sidebarCollapsed,
  onOpenSidebar,
  onExpandSidebar,
  onNewChat,
  localPath,
  embeddedTerminalVisible = false,
  onToggleEmbeddedTerminal,
  rightSidebarVisible = false,
  onToggleRightSidebar,
  onOpenExternal,
  onExportTranscript,
  canExportTranscript = false,
  isExportingTranscript = false,
  editorPreset = "cursor",
  editorCommandTemplate,
  platform = "darwin",
  finderShortcut,
  editorShortcut,
  terminalShortcut,
  rightSidebarShortcut,
  branchName,
  hasGitRepo = true,
  gitStatus = "unknown",
}: Props) {
  const branchLabel = !hasGitRepo
    ? "Setup Git"
    : gitStatus === "unknown"
      ? null
      : (branchName ?? "Detached HEAD")
  const isMac = platform === "darwin"

  return (
    <CardHeader
      className={cn(
        "absolute top-0 left-0 right-0 z-10 md:pt-3 px-3 border-border/0 md:pb-0 flex items-center justify-center",
        " bg-gradient-to-b from-background/70"
      )}
    >
      <div className="relative flex items-center gap-2 w-full">
        <div className={`flex items-center gap-1 flex-shrink-0 border border-border/0 rounded-2xl ${sidebarCollapsed ? 'px-1.5  border-border' : ''} p-1 backdrop-blur-lg`}>
          <Button
            variant="ghost"
            size="icon"
            className="md:hidden"
            onClick={onOpenSidebar}
          >
            <Menu className="size-4.5" />
          </Button>
          {sidebarCollapsed && (
            <>
              <div className="flex items-center justify-center w-[36px] h-[36px]">
                <Flower className="h-4 w-4 sm:h-5 sm:w-5 text-logo ml-1 hidden md:block" />
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex"
                onClick={onExpandSidebar}
                title="Expand sidebar"
              >
                <PanelLeft className="size-4.5" />
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="hover:!border-border/0 hover:!bg-transparent"
            onClick={onNewChat}
            title="Compose"
          >
            <SquarePen className="size-4.5" />
          </Button>
        </div>

        <div className="flex-1 min-w-0" />

        {localPath && (onOpenExternal || onToggleEmbeddedTerminal || onToggleRightSidebar || onExportTranscript) ? (
          <div className="flex items-center gap-2 flex-shrink-0">
            {onOpenExternal ? (
              <div className="hidden py-0.5 md:block border border-border rounded-2xl backdrop-blur-lg">
                <OpenExternalSelect
                  isMac={isMac}
                  editorPreset={editorPreset}
                  editorCommandTemplate={editorCommandTemplate}
                  finderShortcut={finderShortcut}
                  editorShortcut={editorShortcut}
                  onOpenExternal={onOpenExternal}
                />
              </div>
            ) : null}
            {(onToggleEmbeddedTerminal || onToggleRightSidebar || onExportTranscript) ? (
              <div className="flex items-center border border-border rounded-2xl px-2 py-0.5 backdrop-blur-lg">
                {onToggleEmbeddedTerminal ? (
                <HotkeyTooltip>
                  <HotkeyTooltipTrigger asChild>
                    <Button
                      variant="ghost"
                      size="none"
                      onClick={onToggleEmbeddedTerminal}
                      className={cn(
                        "border border-border/0 hover:!border-border/0 px-1.5 h-9 hover:!bg-transparent",
                        embeddedTerminalVisible && "text-foreground"
                      )}
                    >
                      <Terminal strokeWidth={2} className="h-4.5" />
                    </Button>
                  </HotkeyTooltipTrigger>
                  <HotkeyTooltipContent side="bottom" shortcut={terminalShortcut} />
                </HotkeyTooltip>
              ) : null}
                {onExportTranscript ? (
                  <Button
                    variant="ghost"
                    size="none"
                    onClick={onExportTranscript}
                    disabled={!canExportTranscript || isExportingTranscript}
                    title="Export standalone transcript"
                    className="border border-border/0 hover:!border-border/0 px-1.5 h-9 hover:!bg-transparent disabled:opacity-50"
                  >
                    {isExportingTranscript ? <Loader2 className="h-4.5 animate-spin" /> : <UserRoundPlus strokeWidth={2} className="h-4.5" />}
                  </Button>
                ) : null}
                {onToggleRightSidebar ? (
                  <HotkeyTooltip>
                    <HotkeyTooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        onClick={onToggleRightSidebar}
                        className={cn(
                          "border flex flex-row items-center gap-1.5 h-9 border-border/0 pl-1.5 pr-2 hover:!border-border/0 hover:!bg-transparent",
                          rightSidebarVisible && "text-foreground"
                        )}
                      >
                        {rightSidebarVisible ? <PanelRight strokeWidth={2.25} className="h-4" /> : <GitBranch strokeWidth={2.25} className="h-4" />}
                        {branchLabel && !rightSidebarVisible ? <div className="font-[13px] max-w-[140px] truncate hidden md:block">{branchLabel}</div> : null}
                      </Button>
                    </HotkeyTooltipTrigger>
                    <HotkeyTooltipContent side="bottom" shortcut={rightSidebarShortcut} />
                  </HotkeyTooltip>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}
      </div>
    </CardHeader>
  )
}
