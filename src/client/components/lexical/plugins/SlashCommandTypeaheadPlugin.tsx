import { useCallback, useMemo } from "react"
import type { ReactNode, RefObject } from "react"
import { $createTextNode, $insertNodes, TextNode } from "lexical"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { useSlashCommands } from "../../../hooks/useSlashCommands"
import { filterCommands, normalizeCommandName } from "../../../lib/slash-commands"
import { mergePluginCommands } from "../../../lib/plugin-slash-commands"
import {
  selectPluginCommandCenterItems,
  usePluginContributionsStore,
} from "../../../stores/pluginContributionsStore"
import type { SlashCommand } from "../../../../shared/types"
import { $createSlashCommandNode } from "../nodes/SlashCommandNode"
import { clampCommandDescription } from "../../../lib/formatters"
import { ChatTabScopedStore } from "../../../stores/chatTabScopedStore"
import { useTypeaheadHoverHighlight } from "./typeahead-hover-highlight"
import { TypeaheadMenu, useRegexTypeaheadTrigger } from "./typeahead-menu"


const SLASH_TRIGGER_RE = /(?:^|\s)(\/(\S*))$/

export class SlashCommandMenuOption extends MenuOption {
  readonly command: SlashCommand

  constructor(command: SlashCommand) {
    super(command.name)
    this.command = command
  }
}

export function dedupeCommandsByName(commands: SlashCommand[]): SlashCommand[] {
  const seen = new Set<string>()
  const result: SlashCommand[] = []
  for (const cmd of commands) {
    const key = normalizeCommandName(cmd.name)
    if (seen.has(key)) continue
    seen.add(key)
    result.push(cmd)
  }
  return result
}


export interface ApplySlashCommandSelectionArgs {
  readonly command: SlashCommand
  readonly promptByName: ReadonlyMap<string, string>
  readonly textNodeContainingQuery: TextNode | null
}

export function $applySlashCommandSelection({
  command,
  promptByName,
  textNodeContainingQuery,
}: ApplySlashCommandSelectionArgs): void {
  const pluginPrompt = promptByName.get(normalizeCommandName(command.name))
  if (pluginPrompt !== undefined) {
    const promptNode = $createTextNode(pluginPrompt)
    if (textNodeContainingQuery !== null) textNodeContainingQuery.replace(promptNode)
    else $insertNodes([promptNode])
    promptNode.select(pluginPrompt.length, pluginPrompt.length)
    return
  }

  const commandNode = $createSlashCommandNode({
    commandName: normalizeCommandName(command.name),
    hasArgument: Boolean(command.argumentHint),
  })

  if (textNodeContainingQuery !== null) {
    textNodeContainingQuery.replace(commandNode)
  } else {
    $insertNodes([commandNode])
  }

  const trailingSpace = $createTextNode(" ")
  commandNode.insertAfter(trailingSpace)
  trailingSpace.select()
}


function SlashCommandRowContent({ cmd }: { cmd: SlashCommand }) {
  return (
    <>
      <div className="flex min-w-0 items-baseline gap-2">
        <span className="font-mono break-all sm:whitespace-nowrap sm:break-normal">
          /{normalizeCommandName(cmd.name)}
        </span>
        {cmd.kind === "skill" ? (
          <span className="shrink-0 rounded-sm border border-border bg-muted px-1 py-px text-xs font-medium tracking-wide text-muted-foreground">
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
          {clampCommandDescription(cmd.description)}
        </span>
      ) : null}
    </>
  )
}


export interface SlashCommandTypeaheadPluginProps {
  projectId: string | null
}


export function SlashCommandTypeaheadPlugin({
  projectId,
}: SlashCommandTypeaheadPluginProps): ReactNode {
  const query = ChatTabScopedStore.useScopedStore((state) => state.slashQuery)
  const setQuery = ChatTabScopedStore.useScopedStore((state) => state.setSlashQuery)

  const slashCommands = useSlashCommands(projectId)
  const pluginCommandItems = usePluginContributionsStore(selectPluginCommandCenterItems)

  const triggerFn = useRegexTypeaheadTrigger(SLASH_TRIGGER_RE)

  const highlightOnPointerMove = useTypeaheadHoverHighlight()

  const merged = useMemo(
    () => mergePluginCommands(slashCommands, pluginCommandItems),
    [slashCommands, pluginCommandItems],
  )

  const options = useMemo<SlashCommandMenuOption[]>(() => {
    const filtered = filterCommands(merged.commands, query ?? "")
    return dedupeCommandsByName(filtered).map((cmd) => new SlashCommandMenuOption(cmd))
  }, [merged, query])

  const onSelectOption = useCallback(
    (
      option: SlashCommandMenuOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      $applySlashCommandSelection({
        command: option.command,
        promptByName: merged.promptByName,
        textNodeContainingQuery,
      })
      closeMenu()
    },
    [merged],
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
      if (anchorElementRef.current == null) return null
      if (menuOptions.length === 0) return null

      return (
        <TypeaheadMenu
          kind="slash"
          maxHeightClass="max-h-64"
          rowClassName="flex flex-col gap-0.5 px-3 py-1.5 cursor-pointer text-sm sm:flex-row sm:items-center sm:gap-3"
          options={menuOptions}
          selectedIndex={selectedIndex}
          onPick={selectOptionAndCleanUp}
          onRowPointerMove={(event, index) => highlightOnPointerMove(event, index, setHighlightedIndex)}
          renderRow={(option) => <SlashCommandRowContent cmd={option.command} />}
        />
      )
    },
    [highlightOnPointerMove],
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandMenuOption>
      options={options}
      onQueryChange={setQuery}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
