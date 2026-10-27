import { afterEach, describe, expect, test } from "vite-plus/test"
import {
  DEFAULT_CHAT_SOUND_ID,
  DEFAULT_CHAT_SOUND_PREFERENCE,
  normalizeChatSoundId,
  normalizeChatSoundPreference,
  useChatSoundPreferencesStore,
} from "./chatSoundPreferencesStore"

const INITIAL_STATE = useChatSoundPreferencesStore.getInitialState()

afterEach(() => {
  useChatSoundPreferencesStore.setState(INITIAL_STATE)
})

describe("normalizeChatSoundPreference", () => {
  test("accepts supported values", () => {
    expect(normalizeChatSoundPreference("never")).toBe("never")
    expect(normalizeChatSoundPreference("unfocused")).toBe("unfocused")
    expect(normalizeChatSoundPreference("always")).toBe("always")
  })

  test("falls back to the default for unknown values", () => {
    expect(normalizeChatSoundPreference("loud")).toBe(DEFAULT_CHAT_SOUND_PREFERENCE)
    expect(normalizeChatSoundPreference(undefined)).toBe(DEFAULT_CHAT_SOUND_PREFERENCE)
  })
})

describe("normalizeChatSoundId", () => {
  test("accepts supported values", () => {
    expect(normalizeChatSoundId("blow")).toBe("blow")
    expect(normalizeChatSoundId("funk")).toBe("funk")
    expect(normalizeChatSoundId("tink")).toBe("tink")
  })

  test("falls back to the default for unknown values", () => {
    expect(normalizeChatSoundId("gong")).toBe(DEFAULT_CHAT_SOUND_ID)
    expect(normalizeChatSoundId(undefined)).toBe(DEFAULT_CHAT_SOUND_ID)
  })
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
