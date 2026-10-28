import { afterEach, describe, expect, test } from "vite-plus/test"
import { useChatSoundPreferencesStore } from "./chatSoundPreferencesStore"

const INITIAL_STATE = useChatSoundPreferencesStore.getInitialState()

afterEach(() => {
  useChatSoundPreferencesStore.setState(INITIAL_STATE)
})

describe("chat sound preferences store", () => {
  test("defaults to always and funk", () => {
    expect(useChatSoundPreferencesStore.getState().chatSoundPreference).toBe("always")
    expect(useChatSoundPreferencesStore.getState().chatSoundId).toBe("funk")
  })

  test("normalizes stored values through the setters", () => {
    useChatSoundPreferencesStore.getState().setChatSoundPreference("never")
    expect(useChatSoundPreferencesStore.getState().chatSoundPreference).toBe("never")

    useChatSoundPreferencesStore.getState().setChatSoundPreference("invalid" as never)
    expect(useChatSoundPreferencesStore.getState().chatSoundPreference).toBe("always")

    useChatSoundPreferencesStore.getState().setChatSoundId("glass")
    expect(useChatSoundPreferencesStore.getState().chatSoundId).toBe("glass")

    useChatSoundPreferencesStore.getState().setChatSoundId("invalid" as never)
    expect(useChatSoundPreferencesStore.getState().chatSoundId).toBe("funk")
  })
})
