---
title: Keybindings
description: Default keybindings and customization syntax.
---

## Defaults

| Action | macOS | Linux / Windows |
|---|---|---|
| Toggle Embedded Terminal | `Cmd+J` | `Ctrl+\`` |
| Toggle Right Sidebar | `Cmd+B` | `Ctrl+B` |
| Open In Finder | `Cmd+Alt+F` | `Ctrl+Alt+F` |
| Open In Editor | `Cmd+Shift+O` | `Ctrl+Shift+O` |
| Add Split Terminal | `Cmd+/` | `Ctrl+/` |
| Jump To Sidebar Chat | `Cmd+Alt` | `Cmd+Alt` |
| New Chat In Current Project | `Cmd+Alt+N` | `Cmd+Alt+N` |
| Open Add Project | `Cmd+Alt+O` | `Cmd+Alt+O` |
| New Stack | `Cmd+Alt+W` | `Cmd+Alt+W` |
| New Stack Chat | `Cmd+Alt+Shift+N` | `Cmd+Alt+Shift+N` |
| Jump To Stacks | `G S` | `G S` |

### Panes and tabs

| Action | macOS | Linux / Windows |
|---|---|---|
| Focus Pane Left | `Cmd+Ctrl+←` | `Ctrl+Alt+←` |
| Focus Pane Right | `Cmd+Ctrl+→` | `Ctrl+Alt+→` |
| Focus Pane Up | `Cmd+Ctrl+↑` | `Ctrl+Alt+↑` |
| Focus Pane Down | `Cmd+Ctrl+↓` | `Ctrl+Alt+↓` |
| Split Pane Right | `Cmd+Ctrl+D` | `Ctrl+Alt+D` |
| Split Pane Down | `Cmd+Ctrl+E` | `Ctrl+Alt+E` |
| Close Tab | `Cmd+Ctrl+W` | `Ctrl+Alt+Q` |
| Next Tab | `Cmd+Ctrl+J` | `Ctrl+Alt+J` |
| Previous Tab | `Cmd+Ctrl+K` | `Ctrl+Alt+K` |
| Resize Pane Left | `Cmd+Ctrl+Shift+←` | `Ctrl+Alt+Shift+←` |
| Resize Pane Right | `Cmd+Ctrl+Shift+→` | `Ctrl+Alt+Shift+→` |
| Resize Pane Up | `Cmd+Ctrl+Shift+↑` | `Ctrl+Alt+Shift+↑` |
| Resize Pane Down | `Cmd+Ctrl+Shift+↓` | `Ctrl+Alt+Shift+↓` |

These act on the **focused pane** — the one you last clicked into. Pane focus is
shown by the accent bar above that pane's active tab.

Resize moves the **divider** the way the arrow points, in 5% steps, stopping at
each pane's 10% floor. The divider travels the same way whichever of the two
panes beside it holds focus — so with focus on a right-hand pane, `→` slides the
divider right and narrows that pane. The same dividers drag by pointer or touch.

They deliberately avoid `Cmd+Alt`, which is the Jump To Sidebar Chat modifier and
reveals the number-jump hints whenever it is held, and the `Ctrl+Shift` and
`Cmd+W` families, which browsers reserve and a page cannot intercept.

Because every default is a modifier combination, these keep working while a
terminal or the composer has focus. If you rebind one to a bare key, it is
suppressed while you are typing so it cannot swallow your keystrokes.

## Customization

Settings → **Keybindings** → click any row to remap. Each action accepts one or more bindings separated by commas.

Binding syntax: `cmd+k`, `ctrl+shift+p`, `g s`. Supported modifiers: `cmd`/`meta`, `ctrl`/`control`, `alt`/`option`, `shift`.

Conflicts are flagged inline if two actions share a binding.

## Reset

Settings → **Keybindings** → **Reset to defaults**.
