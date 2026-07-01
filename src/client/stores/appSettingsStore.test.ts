import { describe, expect, test } from "bun:test"
import { selectCustomModels } from "./appSettingsStore"

describe("selectCustomModels", () => {
  test("returns a stable empty ref when settings are unset", () => {
    const a = selectCustomModels({ settings: null } as never)
    const b = selectCustomModels({ settings: null } as never)
    expect(a).toBe(b)
    expect(a).toEqual([])
  })

  test("returns the settings.customModels array when present", () => {
    const models = [
      { id: "claude-x", label: "X", provider: "claude" as const, supportsEffort: true, createdAt: 1, updatedAt: 1 },
    ]
    const result = selectCustomModels({ settings: { customModels: models } } as never)
    expect(result).toBe(models)
  })
})
