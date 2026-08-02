import { beforeEach, describe, expect, test } from "bun:test"
import { useSettingsPageStore } from "./settingsPageStore"

describe("settingsPageStore — keybinding drafts", () => {
  beforeEach(() => {
    useSettingsPageStore.setState({ keybindingDrafts: {} })
  })

  test("setKeybindingDraft sets one action without the caller spreading the map", () => {
    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+n")

    expect(useSettingsPageStore.getState().keybindingDrafts).toEqual({ newChat: "mod+n" })
  })

  test("setKeybindingDraft preserves the other drafts", () => {
    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+n")
    useSettingsPageStore.getState().setKeybindingDraft("newStack", "mod+shift+n")
    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+t")

    expect(useSettingsPageStore.getState().keybindingDrafts).toEqual({
      newChat: "mod+t",
      newStack: "mod+shift+n",
    })
  })

  test("setKeybindingDraft produces a new object so selectors see the change", () => {
    const before = useSettingsPageStore.getState().keybindingDrafts
    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+n")
    expect(useSettingsPageStore.getState().keybindingDrafts).not.toBe(before)
  })

  test("re-setting the same value is a no-op", () => {
    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+n")
    const after = useSettingsPageStore.getState().keybindingDrafts

    useSettingsPageStore.getState().setKeybindingDraft("newChat", "mod+n")

    expect(useSettingsPageStore.getState().keybindingDrafts).toBe(after)
  })
})
