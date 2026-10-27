import { describe, expect, test } from "vite-plus/test"
import { Trash2 } from "lucide-react"
import { runContextMenuAction, stackActions, type MenuAction } from "./menuActions"

function fakeSelectEvent() {
  const flags = { prevented: false, stopped: false }
  return {
    flags,
    event: {
      preventDefault: () => {
        flags.prevented = true
      },
      stopPropagation: () => {
        flags.stopped = true
      },
    },
  }
}

function action(overrides: Partial<MenuAction>, ran: string[]): MenuAction {
  return { id: "a", label: "A", icon: Trash2, run: () => ran.push("a"), ...overrides }
}

describe("runContextMenuAction", () => {
  test("an action that closes the menu stops propagation and runs", () => {
    const ran: string[] = []
    const { event, flags } = fakeSelectEvent()
    runContextMenuAction(action({}, ran), event)
    expect(flags).toEqual({ prevented: false, stopped: true })
    expect(ran).toEqual(["a"])
  })

  test("an action that keeps the menu open prevents the default close and runs", () => {
    const ran: string[] = []
    const { event, flags } = fakeSelectEvent()
    runContextMenuAction(action({ keepsMenuOpen: true }, ran), event)
    expect(flags).toEqual({ prevented: true, stopped: false })
    expect(ran).toEqual(["a"])
  })

  test("a disabled action does not run", () => {
    const ran: string[] = []
    const { event } = fakeSelectEvent()
    runContextMenuAction(action({ disabled: true, keepsMenuOpen: true }, ran), event)
    expect(ran).toEqual([])
  })
})

describe("stackActions", () => {
  const handlers = {
    onRename: () => undefined,
    onEditMembers: () => undefined,
    onDelete: () => undefined,
  }

  test("lists rename, edit members and a destructive delete named after the stack", () => {
    const actions = stackActions("Web", handlers, { keepsMenuOpen: true })
    expect(actions.map((a) => a.label)).toEqual(["Rename", "Edit members", "Delete Web"])
    expect(actions.at(-1)?.destructive).toBe(true)
  })

  test("leads with a Boards entry that always closes the menu when a handler is supplied", () => {
    const actions = stackActions("Web", { ...handlers, onOpenBoards: () => undefined }, { keepsMenuOpen: true })
    expect(actions[0]).toMatchObject({ id: "boards", separatorAfter: true })
    expect(actions[0]?.keepsMenuOpen).toBeUndefined()
    expect(actions.slice(1).every((a) => a.keepsMenuOpen === true)).toBe(true)
  })
})
