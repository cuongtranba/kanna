import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { RefreshCw } from "lucide-react"
import { getKeybindingsSubtitle, resolveSettingsSectionId } from "./SettingsPage"
import { SettingsHeaderButton } from "../components/ui/settings-header-button"

describe("resolveSettingsSectionId", () => {
  test("accepts known settings sections", () => {
    expect(resolveSettingsSectionId("general")).toBe("general")
    expect(resolveSettingsSectionId("providers")).toBe("providers")
    expect(resolveSettingsSectionId("changelog")).toBe("changelog")
    expect(resolveSettingsSectionId("keybindings")).toBe("keybindings")
    expect(resolveSettingsSectionId("skills")).toBe("skills")
    expect(resolveSettingsSectionId("subagents")).toBe("subagents")
  })

  test("rejects unknown settings sections", () => {
    expect(resolveSettingsSectionId("page-1")).toBeNull()
    expect(resolveSettingsSectionId("page-2")).toBeNull()
    expect(resolveSettingsSectionId("page-3")).toBeNull()
    expect(resolveSettingsSectionId("nope")).toBeNull()
    expect(resolveSettingsSectionId(undefined)).toBeNull()
  })
})

describe("getKeybindingsSubtitle", () => {
  test("renders the active keybindings path", () => {
    expect(getKeybindingsSubtitle("~/.kanna-dev/keybindings.json")).toBe(
      "Edit global app shortcuts stored in ~/.kanna-dev/keybindings.json."
    )
  })
})

describe("SettingsHeaderButton", () => {
  test("renders shared header button content and icon", () => {
    const html = renderToStaticMarkup(
      <SettingsHeaderButton icon={<RefreshCw className="size-3.5" />}>
        Check for updates
      </SettingsHeaderButton>
    )

    expect(html).toContain("Check for updates")
    expect(html).toContain("lucide-refresh-cw")
    expect(html).toContain("gap-1.5")
  })

  test("supports the default variant for the update action", () => {
    const html = renderToStaticMarkup(
      <SettingsHeaderButton variant="default" >
        Update
      </SettingsHeaderButton>
    )

    expect(html).toContain("Update")
    expect(html).toContain("bg-primary")
  })
})
