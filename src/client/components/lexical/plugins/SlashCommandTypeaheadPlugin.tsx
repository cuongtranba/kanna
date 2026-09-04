import { useCallback, useMemo } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode, RefObject } from "react"
import { $createTextNode, $insertNodes, TextNode } from "lexical"
import type { LexicalEditor } from "lexical"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import type { MenuTextMatch, TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { useSlashCommands } from "../../../hooks/useSlashCommands"
import { commandsForProvider, filterCommands, normalizeCommandName } from "../../../lib/slash-commands"
import { mergePluginCommands } from "../../../lib/plugin-slash-commands"
import {
  selectPluginCommandCenterItems,
  usePluginContributionsStore,
} from "../../../stores/pluginContributionsStore"
import type { AgentProvider, SlashCommand } from "../../../../shared/types"
import { $createSlashCommandNode } from "../nodes/SlashCommandNode"
import { cn } from "../../../lib/utils"
import { clampCommandDescription } from "../../../lib/formatters"
import { ChatTabScopedStore } from "../../../stores/chatTabScopedStore"
import { useTypeaheadHoverHighlight } from "./typeahead-hover-highlight"

// ---------------------------------------------------------------------------
// Custom trigger: slash at the start of the input OR after whitespace.
//
// Mirrors the mention trigger so `/cmd` opens the picker anywhere in the
// composer, not only at the very beginning. A `/` mid-word (e.g. a path like
// `src/file`) does NOT trigger because it must be preceded by start-of-text or
// whitespace. `\S*` terminates the query at the first space.
// ---------------------------------------------------------------------------

const SLASH_TRIGGER_RE = /(?:^|\s)(\/(\S*))$/

function useSlashTrigger(): TriggerFn {
  return useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    const match = SLASH_TRIGGER_RE.exec(text)
    if (match === null) return null
    // match.index = start of the full match (may include a leading space)
    // match[1] = "/query" (no leading whitespace), match[2] = "query"
    // leadOffset = position of `/` in the text
    const leadOffset = match.index + (match[0].length - match[1].length)
    return {
      leadOffset,
      matchingString: match[2] ?? "",
      replaceableString: match[1],
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

/**
 * Dedupe commands by normalized name, keeping the first occurrence. The
 * upstream merge (CLI built-ins + local skill catalog) can surface the same
 * command twice; the picker's option keys (option.key === command.name) must
 * be unique or React emits duplicate-key errors and the typeahead's selection
 * tracking breaks.
 */
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

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export interface ApplySlashCommandSelectionArgs {
  readonly command: SlashCommand
  /** From `mergePluginCommands`. A name present here belongs to a Kanna plugin
   * and expands to text; anything else becomes a `SlashCommandNode`. */
  readonly promptByName: ReadonlyMap<string, string>
  readonly textNodeContainingQuery: TextNode | null
}

/**
 * Writes the picked command into the editor. Runs inside a Lexical update (the
 * typeahead calls `onSelectOption` within one); exported so both branches can
 * be driven from a headless editor.
 *
 * The two branches are NOT interchangeable, and that is the whole plugin
 * command-center decision:
 *
 *   - A CATALOG entry becomes a `SlashCommandNode`, whose text content is
 *     `/name`. Something downstream resolves that name — `runBuiltinCommand`,
 *     or the claude CLI reading the command's file off disk.
 *   - A KANNA PLUGIN entry becomes plain TEXT: the item's own `prompt`. It was
 *     contributed at runtime by a browser bundle, so there is no file to
 *     resolve and no builtin arm to intercept it; `/name` would reach the CLI
 *     as a command it rejects. See `../../../lib/plugin-slash-commands.ts` for
 *     the alternatives considered.
 *
 * `promptByName` carries only entries the merge ACCEPTED, so a hit here can
 * never be a catalog command that a dropped plugin entry happened to shadow.
 */
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
    // Caret at the end of the inserted text: the user reads and edits it before
    // sending, which is the point of inserting prose rather than a command.
    promptNode.select(pluginPrompt.length, pluginPrompt.length)
    return
  }

  // Replace the trigger text (`/query`) with the slash-command node.
  // `.replace()` preserves the caret position (a prior `.remove()` +
  // `$insertNodes` corrupted the selection and submitted raw text).
  const commandNode = $createSlashCommandNode({
    commandName: normalizeCommandName(command.name),
    hasArgument: Boolean(command.argumentHint),
  })

  if (textNodeContainingQuery !== null) {
    textNodeContainingQuery.replace(commandNode)
  } else {
    $insertNodes([commandNode])
  }

  // Inline decorator node can't hold the caret; drop a trailing space text node
  // after it and place the caret there so the user can type the argument.
  const trailingSpace = $createTextNode(" ")
  commandNode.insertAfter(trailingSpace)
  trailingSpace.select()
}

// ---------------------------------------------------------------------------
// Plugin props
// ---------------------------------------------------------------------------

export interface SlashCommandTypeaheadPluginProps {
  /**
   * The catalog is keyed by project, not chat: it comes from the project's cwd,
   * so every chat in a project shares one already-cached list.
   */
  projectId: string | null
  /**
   * Scopes the catalog: Kanna's builtins work everywhere, disk-scanned Claude
   * Code skills only on a provider that runs the claude CLI.
   */
  provider: AgentProvider
}

// ---------------------------------------------------------------------------
// Plugin component
// ---------------------------------------------------------------------------

export function SlashCommandTypeaheadPlugin({
  projectId,
  provider,
}: SlashCommandTypeaheadPluginProps): ReactNode {
  const query = ChatTabScopedStore.useScopedStore((state) => state.slashQuery)
  const setQuery = ChatTabScopedStore.useScopedStore((state) => state.setSlashQuery)

  const slashCommands = useSlashCommands(projectId)
  const pluginCommandItems = usePluginContributionsStore(selectPluginCommandCenterItems)

  const triggerFn = useSlashTrigger()

  const highlightOnPointerMove = useTypeaheadHoverHighlight()

  // Merged AFTER `commandsForProvider`, deliberately. That filter drops the
  // disk-scanned Claude Code entries on codex because only a provider running
  // the claude CLI can resolve them from disk. A Kanna plugin entry is resolved
  // by neither: selecting it inserts the item's own prompt TEXT into the
  // composer (see `plugin-slash-commands.ts` for why that is the only coherent
  // option — there is no file on disk for `/name` to name), so it works on
  // every provider exactly as a builtin does, and filtering it out here would
  // hide a working entry.
  const merged = useMemo(
    () => mergePluginCommands(commandsForProvider(slashCommands, provider), pluginCommandItems),
    [provider, slashCommands, pluginCommandItems],
  )

  const options = useMemo<SlashCommandMenuOption[]>(() => {
    const filtered = filterCommands(merged.commands, query ?? "")
    return dedupeCommandsByName(filtered).map((cmd) => new SlashCommandMenuOption(cmd))
  }, [merged, query])

  const onQueryChange = useCallback((matchingString: string | null) => {
    setQuery(matchingString)
  }, [setQuery])

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
      // No loading state to render: the catalog arrives with the project
      // snapshot, so an empty list means "nothing matches", never "not yet".
      if (menuOptions.length === 0) return null

      // Plain function, not a hook: menuRenderFn is itself a callback.
      // Keeps the handler out of the JSX attribute (selectOptionAndCleanUp
      // is a Lexical callback, not a store action).
      const handleOptionMouseDown = (
        event: ReactMouseEvent<HTMLLIElement>,
        option: SlashCommandMenuOption,
      ) => {
        event.preventDefault()
        selectOptionAndCleanUp(option)
      }

      // Hover follows the POINTER, not the hit test — see
      // useTypeaheadHoverHighlight. `mouseenter` here made every arrow key
      // press hand the highlight straight back to the row the scroll had just
      // moved under a resting cursor (#1019).
      const handleOptionMouseMove = (
        event: ReactMouseEvent<HTMLLIElement>,
        index: number,
      ) => {
        highlightOnPointerMove(event, index, setHighlightedIndex)
      }

      return (
        <ul
          role="listbox"
          data-kanna-typeahead-menu="slash"
          className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {menuOptions.map((option, i) => {
            const isActive = i === selectedIndex
            const cmd = option.command

            return (
              <li
                key={option.key}
                ref={option.setRefElement}
                role="option"
                aria-selected={isActive}
                onMouseDown={(e) => handleOptionMouseDown(e, option)}
                onMouseMove={(e) => handleOptionMouseMove(e, i)}
                className={cn(
                  "flex flex-col gap-0.5 px-3 py-1.5 cursor-pointer text-sm sm:flex-row sm:items-center sm:gap-3",
                  isActive && "bg-accent text-accent-foreground",
                )}
              >
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
              </li>
            )
          })}
        </ul>
      )
    },
    [highlightOnPointerMove],
  )

  return (
    <LexicalTypeaheadMenuPlugin<SlashCommandMenuOption>
      options={options}
      onQueryChange={onQueryChange}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
