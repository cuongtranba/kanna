import { useCallback, useMemo, useState } from "react"
import type { ReactNode, RefObject } from "react"
import { $createTextNode, $insertNodes, TextNode } from "lexical"
import type { LexicalEditor } from "lexical"
import {
  LexicalTypeaheadMenuPlugin,
  MenuOption,
} from "@lexical/react/LexicalTypeaheadMenuPlugin"
import type { MenuTextMatch, TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { AtSign, Bot, Folder, FileText } from "lucide-react"
import { useMentionSuggestions } from "../../../hooks/useMentionSuggestions"
import { useSubagentSuggestions } from "../../../hooks/useSubagentSuggestions"
import type { SubagentSuggestion } from "../../../hooks/useSubagentSuggestions"
import type { ProjectPath } from "../../../hooks/useMentionSuggestions"
import { $createMentionNode } from "../nodes/MentionNode"
import { cn } from "../../../lib/utils"

// ---------------------------------------------------------------------------
// Custom trigger: matches `@` at start of text or after whitespace, allows
// `/` and other path characters in the query string.
//
// Mirrors shouldShowMentionPicker from src/client/lib/mention-suggestions.ts:
// scans backward from caret to find an `@` not preceded by a non-whitespace
// character, then returns everything after `@` as the query.
// ---------------------------------------------------------------------------

// Safe subset of characters that can appear in agent names or file paths
// after the `@` trigger.  Excludes whitespace (menu closes on space) and
// the literal `@` (would start a new mention).
// Whitespace terminates the match; everything else (including `/`, `.`, `-`)
// is valid so `@agent/builder` and `@src/file.ts` keep the menu open.
const MENTION_TRIGGER_RE = /(?:^|\s)(@((?:[^@\s]){0,200}))$/

function useMentionTrigger(): TriggerFn {
  return useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    const match = MENTION_TRIGGER_RE.exec(text)
    if (match === null) return null
    // match.index = start of the full match (may include a leading space)
    // match[1] = "@query" (no leading whitespace), match[2] = "query"
    // leadOffset = position of `@` in the text
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

export type MentionOption =
  | { kind: "agent"; subagent: SubagentSuggestion["subagent"] }
  | { kind: "path"; path: ProjectPath }

export class MentionMenuOption extends MenuOption {
  readonly data: MentionOption

  constructor(data: MentionOption) {
    const key =
      data.kind === "agent"
        ? `agent:${data.subagent.id}`
        : `path:${data.path.kind}:${data.path.path}`
    super(key)
    this.data = data
  }
}

// ---------------------------------------------------------------------------
// Plugin props
// ---------------------------------------------------------------------------

export interface MentionTypeaheadPluginProps {
  projectId: string | null
}

// ---------------------------------------------------------------------------
// Plugin component
// ---------------------------------------------------------------------------

export function MentionTypeaheadPlugin({
  projectId,
}: MentionTypeaheadPluginProps): ReactNode {
  const [query, setQuery] = useState<string | null>(null)

  // Custom trigger: allows `/` and `.` in path queries (e.g., `@agent/builder`
  // or `@src/file.ts`).  useBasicTypeaheadTriggerMatch treats `/` as
  // punctuation and would close the menu after the first `/`.
  const triggerFn = useMentionTrigger()

  const enabled = query !== null

  const mentionState = useMentionSuggestions({
    projectId,
    query: query ?? "",
    enabled,
  })
  const subagentState = useSubagentSuggestions({
    query: query ?? "",
    enabled,
  })

  // Subagents first (mirrors ChatInput.tsx line ~314–317)
  const options = useMemo<MentionMenuOption[]>(() => {
    const agentOpts = subagentState.items.map(
      (s) => new MentionMenuOption({ kind: "agent", subagent: s.subagent }),
    )
    const pathOpts = mentionState.items.map(
      (p) => new MentionMenuOption({ kind: "path", path: p }),
    )
    return [...agentOpts, ...pathOpts]
  }, [subagentState.items, mentionState.items])

  const onQueryChange = useCallback((matchingString: string | null) => {
    setQuery(matchingString)
  }, [])

  const onSelectOption = useCallback(
    (
      option: MentionMenuOption,
      textNodeContainingQuery: TextNode | null,
      closeMenu: () => void,
    ) => {
      // Replace the trigger text (`@query`) with the mention node.
      // textNodeContainingQuery is the TextNode that Lexical split for us;
      // `.replace()` preserves the caret position (a prior `.remove()` +
      // `$insertNodes` corrupted the selection and wiped the composer).
      const data = option.data
      const mentionNode =
        data.kind === "agent"
          ? $createMentionNode({
              mentionKind: "agent",
              value: data.subagent.name,
              label: data.subagent.name,
            })
          : $createMentionNode({
              mentionKind: "path",
              value: data.path.path,
              label: data.path.path,
            })

      if (textNodeContainingQuery !== null) {
        textNodeContainingQuery.replace(mentionNode)
      } else {
        $insertNodes([mentionNode])
      }

      // Inline decorator node can't hold the caret; drop a trailing space
      // text node after it and place the caret there so typing continues.
      const trailingSpace = $createTextNode(" ")
      mentionNode.insertAfter(trailingSpace)
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
        selectOptionAndCleanUp: (option: MentionMenuOption) => void
        setHighlightedIndex: (index: number) => void
        options: MentionMenuOption[]
      },
    ) => {
      if (anchorElementRef.current == null) return null
      if (menuOptions.length === 0 && !mentionState.loading) return null

      return (
        <ul
          role="listbox"
          data-kanna-typeahead-menu="mention"
          className="absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl max-h-64 overflow-auto rounded-md border border-border bg-popover shadow-md"
        >
          {mentionState.loading && menuOptions.length === 0
            ? Array.from({ length: 4 }).map((_, i) => (
                <li
                  key={i}
                  className="flex items-center gap-2 px-3 py-1.5"
                  aria-hidden="true"
                >
                  <span className="h-3.5 w-3.5 rounded bg-muted animate-pulse" />
                  <span className="h-3 w-40 max-w-full rounded bg-muted animate-pulse" />
                </li>
              ))
            : menuOptions.map((option, i) => {
                const isActive = i === selectedIndex
                const data = option.data
                const path = data.kind === "path" ? data.path : null
                const Icon = path?.kind === "dir" ? Folder : FileText
                let mentionContent: React.ReactNode
                if (data.kind === "agent") {
                  mentionContent = (
                    <>
                      <Bot className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate">
                        agent/{data.subagent.name}
                      </span>
                      {data.subagent.description ? (
                        <span className="min-w-0 truncate text-xs text-muted-foreground">
                          {data.subagent.description}
                        </span>
                      ) : null}
                    </>
                  )
                } else if (path) {
                  mentionContent = (
                    <>
                      <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                      <span className="font-mono truncate">{path.path}</span>
                    </>
                  )
                } else {
                  mentionContent = null
                }

                return (
                  <li
                    key={option.key}
                    ref={option.setRefElement}
                    role="option"
                    aria-selected={isActive}
                    onMouseDown={(e) => {
                      e.preventDefault()
                      selectOptionAndCleanUp(option)
                    }}
                    onMouseEnter={() => setHighlightedIndex(i)}
                    className={cn(
                      "flex items-center gap-2 px-3 py-1.5 cursor-pointer text-sm",
                      isActive && "bg-accent text-accent-foreground",
                    )}
                  >
                    <AtSign className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    {mentionContent}
                  </li>
                )
              })}
        </ul>
      )
    },
    [mentionState.loading],
  )

  return (
    <LexicalTypeaheadMenuPlugin<MentionMenuOption>
      options={options}
      onQueryChange={onQueryChange}
      onSelectOption={onSelectOption}
      triggerFn={triggerFn}
      menuRenderFn={menuRenderFn}
    />
  )
}
