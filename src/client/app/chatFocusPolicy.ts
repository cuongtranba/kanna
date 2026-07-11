export const FOCUS_FALLBACK_IGNORE_ATTRIBUTE = "data-focus-fallback-ignore"
export const ALLOW_FOCUS_RETAIN_ATTRIBUTE = "data-allow-focus-retain"
export const RESTORE_CHAT_INPUT_FOCUS_EVENT = "kanna:restore-chat-input-focus"
export const CHAT_INPUT_ATTRIBUTE = "data-chat-input"
export const CHAT_SELECTION_ZONE_ATTRIBUTE = "data-chat-selection-zone"

export type ChatFocusAction = "restore" | "escape-focus" | "none"

type RootLike = {
  contains: (other: Node | null) => boolean
}

function hasAttributeInTree(element: Element | null, attribute: string) {
  return Boolean(element?.closest(`[${attribute}]`))
}

export function isTextEntryTarget(element: Element | null): boolean {
  if (!element?.matches) return false
  if (element.matches("input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select")) {
    return true
  }
  if (element instanceof HTMLElement && element.isContentEditable) return true
  if (element.getAttribute?.("role") === "textbox") return true
  return hasAttributeInTree(element, ALLOW_FOCUS_RETAIN_ATTRIBUTE)
}

export function isFocusableTarget(element: Element | null): boolean {
  if (!element?.matches) return false
  if (isTextEntryTarget(element)) return true
  if (element instanceof HTMLElement && (element.tabIndex ?? -1) >= 0) return true
  if (element.matches("button, a[href], summary")) return true
  return hasAttributeInTree(element, ALLOW_FOCUS_RETAIN_ATTRIBUTE)
}

export function hasActiveFocusOverlay(document: Document): boolean {
  return Boolean(document.querySelector(`[${FOCUS_FALLBACK_IGNORE_ATTRIBUTE}][data-state='open']`))
}

export function hasActiveTextSelection(selection: Selection | null | undefined): boolean {
  if (!selection) return false
  return !selection.isCollapsed && selection.toString().trim().length > 0
}

export function focusNextChatInput(current: HTMLTextAreaElement | null, document: Document) {
  if (!current) return false

  const chatInputs = Array.from(document.querySelectorAll<HTMLTextAreaElement>(`textarea[${CHAT_INPUT_ATTRIBUTE}]`))
    .filter((element) => !element.disabled)

  if (chatInputs.length === 0) return false

  const currentIndex = chatInputs.indexOf(current)
  const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % chatInputs.length : 0
  const nextInput = chatInputs[nextIndex]
  if (!nextInput) return false

  nextInput.focus({ preventScroll: true })
  return true
}

export function resolveChatFocusAction(args:
  | {
    trigger: "escape"
    activeElement: Element | null
    fallback: HTMLTextAreaElement | null
    hasActiveOverlay: boolean
    canCancel: boolean
    defaultPrevented: boolean
  }
  | {
    trigger: "pointer"
    activeElement: Element | null
    pointerStartTarget: Element | null
    pointerEndTarget: Element | null
    root: RootLike | null
    fallback: { disabled?: boolean } | null
    hasActiveOverlay: boolean
    hasActiveSelection: boolean
  },
): ChatFocusAction {
  const { activeElement, fallback, hasActiveOverlay } = args

  if (!fallback || fallback.disabled) return "none"
  if (hasActiveOverlay) return "none"
  if (activeElement === fallback) return "none"

  if (args.trigger === "escape") {
    if (args.defaultPrevented) return "none"
    if (hasAttributeInTree(activeElement, CHAT_INPUT_ATTRIBUTE)) return "none"
    if (args.canCancel) return "none"
    return "escape-focus"
  }

  const { pointerStartTarget, pointerEndTarget, root, hasActiveSelection } = args
  const interactionTarget = pointerEndTarget ?? pointerStartTarget

  if (!root || !interactionTarget || !root.contains(interactionTarget)) return "none"
  if (hasAttributeInTree(interactionTarget, FOCUS_FALLBACK_IGNORE_ATTRIBUTE)) return "none"
  if (hasAttributeInTree(activeElement, FOCUS_FALLBACK_IGNORE_ATTRIBUTE)) return "none"
  if (
    hasActiveSelection
    && (
      hasAttributeInTree(pointerStartTarget, CHAT_SELECTION_ZONE_ATTRIBUTE)
      || hasAttributeInTree(interactionTarget, CHAT_SELECTION_ZONE_ATTRIBUTE)
    )
  ) {
    return "none"
  }
  if (isTextEntryTarget(activeElement)) return "none"
  if (activeElement && activeElement === interactionTarget) return "restore"
  return isFocusableTarget(activeElement) ? "none" : "restore"
}
