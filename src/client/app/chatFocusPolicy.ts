export const FOCUS_FALLBACK_IGNORE_ATTRIBUTE = "data-focus-fallback-ignore"
export const ALLOW_FOCUS_RETAIN_ATTRIBUTE = "data-allow-focus-retain"
export const RESTORE_CHAT_INPUT_FOCUS_EVENT = "kanna:restore-chat-input-focus"

type ElementLike = {
  closest?: (selector: string) => Element | null
  matches?: (selector: string) => boolean
  getAttribute?: (name: string) => string | null
  tabIndex?: number
  isContentEditable?: boolean
}

type RootLike = {
  contains: (other: Node | null) => boolean
}

function hasAttributeInTree(element: Element | null, attribute: string) {
  return Boolean(element?.closest(`[${attribute}]`))
}

export function isTextEntryTarget(element: Element | null): boolean {
  const candidate = element as ElementLike | null
  if (!candidate?.matches) return false
  if (candidate.matches("input:not([type='checkbox']):not([type='radio']):not([type='button']):not([type='submit']):not([type='reset']), textarea, select")) {
    return true
  }
  if (candidate.isContentEditable) return true
  if (candidate.getAttribute?.("role") === "textbox") return true
  return hasAttributeInTree(element, ALLOW_FOCUS_RETAIN_ATTRIBUTE)
}

export function isFocusableTarget(element: Element | null): boolean {
  const candidate = element as ElementLike | null
  if (!candidate?.matches) return false
  if (isTextEntryTarget(element)) return true
  if ((candidate.tabIndex ?? -1) >= 0) return true
  if (candidate.matches("button, a[href], summary")) return true
  return hasAttributeInTree(element, ALLOW_FOCUS_RETAIN_ATTRIBUTE)
}

export function hasActiveFocusOverlay(document: Document): boolean {
  return Boolean(document.querySelector(`[${FOCUS_FALLBACK_IGNORE_ATTRIBUTE}][data-state='open']`))
}

export function shouldRestoreChatInputFocus(args: {
  activeElement: Element | null
  pointerTarget: Element | null
  root: RootLike | null
  fallback: { disabled?: boolean } | null
  hasActiveOverlay: boolean
}): boolean {
  const { activeElement, pointerTarget, root, fallback, hasActiveOverlay } = args

  if (!root || !fallback || fallback.disabled) return false
  if (!pointerTarget || !root.contains(pointerTarget)) return false
  if (hasAttributeInTree(pointerTarget, FOCUS_FALLBACK_IGNORE_ATTRIBUTE)) return false
  if (hasActiveOverlay) return false
  if (activeElement === fallback) return false
  if (hasAttributeInTree(activeElement, FOCUS_FALLBACK_IGNORE_ATTRIBUTE)) return false
  if (isTextEntryTarget(activeElement)) return false
  if (activeElement && activeElement === pointerTarget) return true
  return !isFocusableTarget(activeElement)
}
