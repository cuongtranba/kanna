import { describe, expect, test } from "bun:test"
import {
  selectChatSoundId,
  selectChatSoundPreference,
  selectCustomModels,
  selectEditorCommandTemplate,
  selectEditorPreset,
  selectMinColumnWidth,
  selectScrollbackLines,
} from "./appSettingsStore"

describe("terminal preference selectors", () => {
  test("selectScrollbackLines returns default when settings null", () => {
    const a = selectScrollbackLines({ settings: null } as never)
    const b = selectScrollbackLines({ settings: null } as never)
    expect(typeof a).toBe("number")
    expect(a).toBe(b)
  })

  test("selectScrollbackLines returns settings value when present", () => {
    const result = selectScrollbackLines({ settings: { terminal: { scrollbackLines: 9999 } } } as never)
    expect(result).toBe(9999)
  })

  test("selectMinColumnWidth returns default when settings null", () => {
    expect(typeof selectMinColumnWidth({ settings: null } as never)).toBe("number")
  })

  test("selectEditorPreset returns default when settings null", () => {
    expect(typeof selectEditorPreset({ settings: null } as never)).toBe("string")
  })

  test("selectEditorCommandTemplate returns non-empty string when settings null", () => {
    expect(typeof selectEditorCommandTemplate({ settings: null } as never)).toBe("string")
  })
})

describe("chatSound selectors", () => {
  test("selectChatSoundPreference returns default when settings null", () => {
    expect(typeof selectChatSoundPreference({ settings: null } as never)).toBe("string")
  })

  test("selectChatSoundId returns default when settings null", () => {
    expect(typeof selectChatSoundId({ settings: null } as never)).toBe("string")
  })

  test("selectChatSoundPreference returns settings value when present", () => {
    const result = selectChatSoundPreference({ settings: { chatSoundPreference: "never" } } as never)
    expect(result).toBe("never")
  })
})

describe("selectCustomModels", () => {
  test("returns a stable empty ref when settings are unset", () => {
    const a = selectCustomModels({ settings: null } as never)
    const b = selectCustomModels({ settings: null } as never)
    expect(a).toBe(b)
    expect(a).toEqual([])
  })

  test("returns the settings.customModels array when present", () => {
    const models = [
      { id: "claude-x", label: "X", provider: "claude" as const, createdAt: 1, updatedAt: 1 },
    ]
    const result = selectCustomModels({ settings: { customModels: models } } as never)
    expect(result).toBe(models)
  })
})
