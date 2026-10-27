import { describe, expect, test } from "bun:test"
import {
  DEFAULT_CHAT_SOUND_ID,
  DEFAULT_CHAT_SOUND_PREFERENCE,
  normalizeChatSoundId,
  normalizeChatSoundPreference,
} from "./chat-sound"

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
