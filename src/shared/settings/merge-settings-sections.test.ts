import { describe, expect, test } from "vite-plus/test"
import { mergeAppSettingsPatch } from "./merge-settings-sections"
import { defaultAppSettingsSnapshot } from "../../server/app-settings"

describe("mergeAppSettingsPatch", () => {
  test("merges nested provider options without dropping sibling fields", () => {
    const snapshot = defaultAppSettingsSnapshot()
    const merged = mergeAppSettingsPatch(snapshot, {
      providerDefaults: { claude: { planMode: true } },
    })
    expect(merged.providerDefaults.claude).toEqual({ ...snapshot.providerDefaults.claude, planMode: true })
    expect(merged.providerDefaults.codex).toEqual(snapshot.providerDefaults.codex)
  })

  test("a subagent runtime patch keeps the field it does not name", () => {
    const snapshot = defaultAppSettingsSnapshot()
    const merged = mergeAppSettingsPatch(snapshot, { subagentRuntime: { defaultLoopSubagentId: "s1" } })
    expect(merged.subagentRuntime).toEqual({ runTimeoutMs: snapshot.subagentRuntime.runTimeoutMs, defaultLoopSubagentId: "s1" })
  })

  test("collection patches never reach the merged collections", () => {
    const snapshot = defaultAppSettingsSnapshot()
    const merged = mergeAppSettingsPatch(snapshot, {
      subagents: { delete: { id: "x" } },
      customBeacons: { setEnabled: { id: "b", enabled: true } },
    })
    expect(merged.subagents).toBe(snapshot.subagents)
    expect(merged.customBeacons).toBe(snapshot.customBeacons)
  })
})
