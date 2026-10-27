import { useCallback } from "react"
import type { MouseEvent as ReactMouseEvent, ReactNode } from "react"
import type { LexicalEditor } from "lexical"
import type { MenuOption, MenuTextMatch, TriggerFn } from "@lexical/react/LexicalTypeaheadMenuPlugin"
import { cn } from "../../../lib/utils"
import { TYPEAHEAD_MENU_ATTRIBUTE } from "../../../lib/typeaheadMenuAttribute"

export function useRegexTypeaheadTrigger(triggerRegex: RegExp): TriggerFn {
  return useCallback((text: string, _editor: LexicalEditor): MenuTextMatch | null => {
    const match = triggerRegex.exec(text)
    if (match === null) return null
    const leadOffset = match.index + (match[0].length - match[1].length)
    return {
      leadOffset,
      matchingString: match[2] ?? "",
      replaceableString: match[1],
    }
  }, [triggerRegex])
}

interface TypeaheadMenuProps<T extends MenuOption> {
  kind: string
  maxHeightClass: string
  rowClassName: string
  options: readonly T[]
  selectedIndex: number | null
  onPick: (option: T) => void
  onRowPointerMove: (event: ReactMouseEvent<HTMLLIElement>, index: number) => void
  renderRow: (option: T) => ReactNode
  placeholder?: ReactNode
}

export function TypeaheadMenu<T extends MenuOption>({
  kind,
  maxHeightClass,
  rowClassName,
  options,
  selectedIndex,
  onPick,
  onRowPointerMove,
  renderRow,
  placeholder,
}: TypeaheadMenuProps<T>) {
  return (
    <ul
      role="listbox"
      {...{ [TYPEAHEAD_MENU_ATTRIBUTE]: kind }}
      className={cn(
        "absolute bottom-full left-0 mb-2 w-full max-w-md md:max-w-xl overflow-auto rounded-md border border-border bg-popover shadow-md",
        maxHeightClass,
      )}
    >
      {placeholder ?? options.map((option, index) => (
        <li
          key={option.key}
          ref={option.setRefElement}
          role="option"
          aria-selected={index === selectedIndex}
          onMouseDown={(event) => {
            event.preventDefault()
            onPick(option)
          }}
          onMouseMove={(event) => onRowPointerMove(event, index)}
          className={cn(rowClassName, index === selectedIndex && "bg-accent text-accent-foreground")}
        >
          {renderRow(option)}
        </li>
      ))}
    </ul>
  )
}
