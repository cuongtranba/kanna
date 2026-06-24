import { useCallback, useMemo, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { $createTextNode, $insertNodes, TextNode } from "lexical"
import type { LexicalEditor } from "lexical"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import type { MenuTextMatch, TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { useSlashCommands, useSlashCommandsLoading } from "../../../hooks/useSlashCommands"
import { filterCommands, normalizeCommandName } from "../../../lib/slash-commands"
import type { SlashCommand } from "../../../../shared/types"
import { $createSlashCommandNode } from "../nodes/SlashCommandNode"
import { cn } from "../../../lib/utils"

// ---------------------------------------------------------------------------
// Custom trigger: slash only at the very start of the input
//
// Mirrors shouldShowPicker from src/client/lib/slash-commands.ts which checks
// that the text up to the caret matches /^\/(\S*)$/.  We reproduce that check
// here as a Lexical TriggerFn so the typeahead plugin uses the same semantics.
// ---------------------------------------------------------------------------

const SLASH_AT_START_RE = /^\/(\S*)$/

function useSlashAtStartTrigger(): TriggerFn {
  return useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    const match = SLASH_AT_START_RE.exec(text)
    if (match === null) return null
    return {
      leadOffset: 0,
      matchingString: match[1] ?? "",
      replaceableString: match[0],
    }
  }, [])
}

// ---------------------------------------------------------------------------
// MenuOption subclass
// ---------------------------------------------------------------------------

export class SlashCommandMenuOption extends MenuOption {
  readonly command: SlashCommand

  constructor(command: SlashCommand) {
    super(command.name)
    this.command = command
  }
}

// ---------------------------------------------------------------------------
// Plugin props
// ---------------------------------------------------------------------------

export interface SlashCommandTypeaheadPluginProps {
  chatId: string | null
  /**
   * When false the plugin renders nothing (mirrors the ChatInput gating that
   * only shows the slash picker when selectedProvider === "claude").
   */
  enabled: boolean
}

// ---------------------------------------------------------------------------
// Plugin component
// ---------------------------------------------------------------------------

const DESCRIPTION_MAX_CHARS = 80

function clampDescription(text: string): string {
  if (text.length <= DESCRIPTION_MAX_CHARS) return text
  return `${text.slice(0, DESCRIPTION_MAX_CHARS - 1).trimEnd()}…`
}

export function SlashCommandTypeaheadPlugin({
  chatId,
  enabled,
}: SlashCommandTypeaheadPluginProps): ReactNode {
  const [query, setQuery] = useState<string | null>(null)

  const slashCommands = useSlashCommands(chatId)
  const loading = useSlashCommandsLoading(chatId)

  const triggerFn = useSlashAtStartTrigger()

  const options = useMemo<SlashCommandMenuOption[]>(() => {
    if (!enabled) return []
    const filtered = filterCommands(slashCommands, query ?? "")
    return filtered.map((cmd) => new SlashCommandMenuOption(cmd))
  }, [enabled, slashCommands, query])

  const onQueryChange = useCallback((matchingString: string | null) => {
    setQuery(matchingString)
  }, [])

  const onSelectOption = useCallback(
    (
      option: SlashCommandMenuOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      // Replace the trigger text (`/query`) with the slash-command node.
      // `.replace()` preserves the caret position (a prior `.remove()` +
      // `$insertNodes` corrupted the selection and submitted raw text).
      const cmd = option.command
      const commandNode = $createSlashCommandNode({
        commandName: normalizeCommandName(cmd.name),
        hasArgument: Boolean(cmd.argumentHint),
      })

      if (textNodeContainingQuery !== null) {
        textNodeContainingQuery.replace(commandNode)
      } else {
        $insertNodes([commandNode])
      }

      // Inline decorator node can't hold the caret; drop a trailing space
      // text node after it and place the caret there so the user can type
      // the command argument.
      const trailingSpace = $createTextNode(" ")
      commandNode.insertAfter(trailingSpace)
      trailingSpace.select()

      closeMenu()
    },
    [],
  )

  const menuRenderFn = useCallback(
    (
      anchorElementRef: RefObject<HTMLElement | null>,
      {
        selectedIndex,
        selectOptionAndCleanUp,
        setHighlightedIndex,
        options: menuOptions,
      }: {
        selectedIndex: number | null
        selectOptionAndCleanUp: (option: SlashCommandMenuOption) => void
        setHighlightedIndex: (index: number) => void
        options: SlashCommandMenuOption[]
      },
    ) => {
      if (!enabled) return null
      if (anchorElementRef.current == null) return null
      if (menuOptions.length === 0 && !loading) return null

      return (
        <ul
          role="listbox"
          data-kanna-typeahead-menu="slash"
          className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {loading && menuOptions.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <li
                  key={i}
                  className="flex flex-col gap-1 px-3 py-1.5 sm:flex-row sm:items-center sm:gap-3"
                  aria-hidden="true"
                >
                  <span className="h-3 w-28 rounded bg-muted animate-pulse" />
                  <span className="hidden h-3 w-16 rounded bg-muted/70 animate-pulse sm:inline-block" />
                  <span className="h-3 w-40 max-w-full rounded bg-muted/60 animate-pulse sm:ml-auto" />
                </li>
              ))
            : menuOptions.map((option, i) => {
                const isActive = i === selectedIndex
                const cmd = option.command
                const scopeTitle = cmd.scope
                  ? `${cmd.scope.charAt(0).toUpperCase()}${cmd.scope.slice(1)}`
                  : undefined

                return (
                  <li
                    key={option.key}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectOptionAndCleanUp(option)
                    }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={cn(
                      "flex flex-col gap-0.5 px-3 py-1.5 cursor-pointer text-sm sm:flex-row sm:items-center sm:gap-3",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                    title={scopeTitle}
                  >
                    <div className="flex min-w-0 items-baseline gap-2">
                      <span className="font-mono break-all sm:whitespace-nowrap sm:break-normal">
                        /{normalizeCommandName(cmd.name)}
                      </span>
                      {cmd.kind === "skill" ? (
                        <span className="shrink-0 rounded-sm border border-border bg-muted px-1 py-px text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                          skill
                        </span>
                      ) : null}
                      {cmd.argumentHint ? (
                        <span className="shrink-0 font-mono text-xs text-muted-foreground whitespace-nowrap">
                          {cmd.argumentHint}
                        </span>
                      ) : null}
                    </div>
                    {cmd.description ? (
                      <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground sm:text-right">
                        {clampDescription(cmd.description)}
                      </span>
                    ) : null}
                  </li>
                )
              })}
        </ul>
      )
    },
    [enabled, loading],
  )

  // When disabled, still mount the plugin but with no options so it never opens.
  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandMenuOption>
      options={enabled ? options : []}
      onQueryChange={onQueryChange}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
