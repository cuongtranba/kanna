import { DEFAULT_KEYBINDINGS, type KeybindingAction, type KeybindingsSnapshot } from "../../shared/types"

export const KEYBINDING_ACTION_LABELS: Record<KeybindingAction, string> = {
  toggleEmbeddedTerminal: "Toggle Embedded Terminal",
  toggleRightSidebar: "Toggle Right Sidebar",
  openInFinder: "Open In Finder",
  openInEditor: "Open In Editor",
  addSplitTerminal: "Add Split Terminal",
  jumpToSidebarChat: "Jump To Sidebar Chat",
  openProjectSwitcher: "Open Project Switcher",
  openTabSwitcher: "Switch To Recent Tab",
  jumpToPaneTab: "Jump To Tab By Number",
  createChatInCurrentProject: "New Chat In Current Project",
  openAddProject: "Open Add Project",
  newStack: "New Stack",
  newStackChat: "New Stack Chat",
  jumpToStacks: "Jump To Stacks",
  focusPaneLeft: "Focus Pane Left",
  focusPaneRight: "Focus Pane Right",
  focusPaneUp: "Focus Pane Up",
  focusPaneDown: "Focus Pane Down",
  splitPaneRight: "Split Pane Right",
  splitPaneDown: "Split Pane Down",
  closePaneTab: "Close Tab",
  nextPaneTab: "Next Tab",
  previousPaneTab: "Previous Tab",
  resizePaneLeft: "Resize Pane Left",
  resizePaneRight: "Resize Pane Right",
  resizePaneUp: "Resize Pane Up",
  resizePaneDown: "Resize Pane Down",
}

export function formatKeybindingInput(bindings: string[] | undefined) {
  return (bindings ?? []).join(", ")
}

export function parseKeybindingInput(value: string) {
  return value
    .split(",")
    .map((binding) => binding.trim())
    .map((binding) => binding.toLowerCase())
    .filter(Boolean)
}

type ParsedBinding = {
  key: string
  ctrl: boolean
  meta: boolean
  alt: boolean
  shift: boolean
}

const MODIFIER_TOKENS = new Map([
  ["cmd", "meta"],
  ["meta", "meta"],
  ["ctrl", "ctrl"],
  ["control", "ctrl"],
  ["alt", "alt"],
  ["option", "alt"],
  ["shift", "shift"],
])

export function bindingMatchesEvent(binding: string, event: KeyboardEvent) {
  const parsed = parseBinding(binding)
  if (!parsed) return false

  return (
    eventMatchesParsedKey(event, parsed.key) &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    event.shiftKey === parsed.shift
  )
}

export function actionMatchesEvent(
  snapshot: KeybindingsSnapshot | null,
  action: KeybindingAction,
  event: KeyboardEvent
) {
  const bindings = getBindingsForAction(snapshot, action)
  return bindings.some((binding) => bindingMatchesEvent(binding, event))
}

export function findMatchingActionBinding(
  snapshot: KeybindingsSnapshot | null,
  action: KeybindingAction,
  event: KeyboardEvent
) {
  return getBindingsForAction(snapshot, action).find((binding) => bindingMatchesEvent(binding, event)) ?? null
}

export function getBindingsForAction(
  snapshot: KeybindingsSnapshot | null,
  action: KeybindingAction
) {
  return snapshot?.bindings[action] ?? DEFAULT_KEYBINDINGS[action]
}

function isKeybindingAction(key: string): key is KeybindingAction {
  return Object.hasOwn(DEFAULT_KEYBINDINGS, key)
}

function keybindingActionKeys(): KeybindingAction[] {
  return Object.keys(DEFAULT_KEYBINDINGS).filter(isKeybindingAction)
}

export function getResolvedKeybindings(snapshot: KeybindingsSnapshot | null): KeybindingsSnapshot {
  const bindings: Record<KeybindingAction, string[]> = { ...DEFAULT_KEYBINDINGS }
  for (const action of keybindingActionKeys()) {
    bindings[action] = snapshot?.bindings[action] ?? DEFAULT_KEYBINDINGS[action]
  }
  return {
    bindings,
    warning: snapshot?.warning ?? null,
    filePathDisplay: snapshot?.filePathDisplay ?? "",
  }
}

type ModifierState = Pick<KeyboardEvent, "metaKey" | "altKey" | "ctrlKey" | "shiftKey">

export function bindingModifiersMatch(binding: string, event: ModifierState): boolean {
  const parsed = parseModifiers(binding)
  return (
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    event.ctrlKey === parsed.ctrl &&
    event.shiftKey === parsed.shift
  )
}

export function bindingMatchesEventIgnoringShift(binding: string, event: KeyboardEvent): boolean {
  const parsed = parseBinding(binding)
  if (!parsed) return false

  return (
    eventMatchesParsedKey(event, parsed.key) &&
    event.ctrlKey === parsed.ctrl &&
    event.metaKey === parsed.meta &&
    event.altKey === parsed.alt &&
    (!parsed.shift || event.shiftKey)
  )
}

export function bindingModifiersReleased(binding: string, event: ModifierState): boolean {
  const parsed = parseModifiers(binding)
  const required = [
    [parsed.meta, event.metaKey],
    [parsed.ctrl, event.ctrlKey],
    [parsed.alt, event.altKey],
  ].filter(([needed]) => needed)
  if (required.length === 0) return false
  return required.some(([, isDown]) => !isDown)
}

export function pickPlatformBinding(bindings: readonly string[], isMac: boolean): string | null {
  const usesCmd = (binding: string) => parseModifiers(binding).meta
  return (
    bindings.find((binding) => usesCmd(binding) === isMac) ??
    (isMac ? bindings[0] : undefined) ??
    null
  )
}

const MAC_GLYPHS = { meta: "⌘", ctrl: "⌃", alt: "⌥", shift: "⇧" } as const
const PC_GLYPHS = { meta: "Win", ctrl: "Ctrl", alt: "Alt", shift: "Shift" } as const
const KEY_GLYPHS: Readonly<Record<string, string>> = {
  arrowleft: "←",
  arrowright: "→",
  arrowup: "↑",
  arrowdown: "↓",
  enter: "↵",
  escape: "Esc",
  tab: "Tab",
}

export function formatBindingKeys(binding: string, isMac: boolean): string[] {
  const glyphs = isMac ? MAC_GLYPHS : PC_GLYPHS
  return binding
    .split("+")
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean)
    .map((token) => {
      const modifier = MODIFIER_TOKENS.get(token)
      if (modifier === "ctrl" || modifier === "meta" || modifier === "alt" || modifier === "shift") {
        return glyphs[modifier]
      }
      return KEY_GLYPHS[token] ?? (token.length === 1 ? token.toUpperCase() : token)
    })
}

function parseModifiers(binding: string): Omit<ParsedBinding, "key"> {
  const parsed = { ctrl: false, meta: false, alt: false, shift: false }
  for (const part of binding.split("+")) {
    const modifier = MODIFIER_TOKENS.get(part.trim().toLowerCase())
    if (modifier === "ctrl" || modifier === "meta" || modifier === "alt" || modifier === "shift") {
      parsed[modifier] = true
    }
  }
  return parsed
}

function parseBinding(binding: string): ParsedBinding | null {
  const parts = binding.split("+").map((part) => part.trim()).filter(Boolean)
  if (parts.length === 0) return null

  const parsed: ParsedBinding = {
    key: "",
    ctrl: false,
    meta: false,
    alt: false,
    shift: false,
  }

  for (const part of parts) {
    const token = part.toLowerCase()
    const modifier = MODIFIER_TOKENS.get(token)
    if (modifier === "ctrl") {
      parsed.ctrl = true
      continue
    }
    if (modifier === "meta") {
      parsed.meta = true
      continue
    }
    if (modifier === "alt") {
      parsed.alt = true
      continue
    }
    if (modifier === "shift") {
      parsed.shift = true
      continue
    }
    if (parsed.key) {
      return null
    }
    parsed.key = token
  }

  return parsed.key ? parsed : null
}

function eventMatchesParsedKey(event: KeyboardEvent, key: string) {
  if (event.key.toLowerCase() === key) {
    return true
  }

  const expectedCode = keyToCode(key)
  if (!expectedCode) {
    return false
  }

  return event.code === expectedCode
}

function keyToCode(key: string) {
  if (key.length === 1 && key >= "a" && key <= "z") {
    return `Key${key.toUpperCase()}`
  }
  if (key.length === 1 && key >= "0" && key <= "9") {
    return `Digit${key}`
  }

  switch (key) {
    case "/":
      return "Slash"
    case "`":
      return "Backquote"
    default:
      return null
  }
}
