import { beforeEach, describe, expect, test } from "vite-plus/test"
import { useKeybindingsSectionStore } from "./keybindingsSectionStore"

describe("keybindingsSectionStore — keybinding drafts", () => {
  beforeEach(() => {
    useKeybindingsSectionStore.setState({ drafts: {} })
  })

  test("setDraft sets one action without the caller spreading the map", () => {
    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+n")

    expect(useKeybindingsSectionStore.getState().drafts).toEqual({ newChat: "mod+n" })
  })

  test("setDraft preserves the other drafts", () => {
    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+n")
    useKeybindingsSectionStore.getState().setDraft("newStack", "mod+shift+n")
    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+t")

    expect(useKeybindingsSectionStore.getState().drafts).toEqual({
      newChat: "mod+t",
      newStack: "mod+shift+n",
    })
  })

  test("setDraft produces a new object so selectors see the change", () => {
    const before = useKeybindingsSectionStore.getState().drafts
    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+n")
    expect(useKeybindingsSectionStore.getState().drafts).not.toBe(before)
  })

  test("re-setting the same value is a no-op", () => {
    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+n")
    const after = useKeybindingsSectionStore.getState().drafts

    useKeybindingsSectionStore.getState().setDraft("newChat", "mod+n")

    expect(useKeybindingsSectionStore.getState().drafts).toBe(after)
  })
})
