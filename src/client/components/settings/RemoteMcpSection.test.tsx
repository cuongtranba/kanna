import { afterEach, describe, expect, test } from "vite-plus/test"
import { defaultAppSettingsSnapshot } from "../../../server/app-settings"
import type { RemoteMcpSettings } from "../../../shared/settings/remote-mcp"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { useAppSettingsStore } from "../../stores/appSettingsStore"
import { useRemoteMcpSectionStore } from "../../stores/remoteMcpSectionStore"
import { useAuthStatusStore } from "../../stores/authStatusStore"
import { RemoteMcpSection } from "./RemoteMcpSection"

const APP_SETTINGS_INITIAL = useAppSettingsStore.getInitialState()
const SECTION_INITIAL = useRemoteMcpSectionStore.getInitialState()
const AUTH_STATUS_INITIAL = useAuthStatusStore.getInitialState()
const STATE = { handleWriteAppSettings: async () => {} }

afterEach(() => {
  useAppSettingsStore.setState(APP_SETTINGS_INITIAL)
  useRemoteMcpSectionStore.setState(SECTION_INITIAL)
  useAuthStatusStore.setState(AUTH_STATUS_INITIAL)
})

function seed(remoteMcp: RemoteMcpSettings, authEnabled: boolean) {
  useAppSettingsStore.getState().setFromServer({ ...defaultAppSettingsSnapshot(), remoteMcp })
  useAuthStatusStore.setState({ authEnabled })
}

describe("RemoteMcpSection", () => {
  test("without a password it says how to enable the server", async () => {
    seed({ enabled: true, publicUrl: null }, false)

    const rendered = await renderClientMarkup(<RemoteMcpSection state={STATE} />)

    expect(rendered.html).toContain("Set --password when starting Kanna to enable the remote MCP server")
    await rendered.cleanup()
  })

  test("with a password and a public url it shows the endpoint and a setup card per client", async () => {
    seed({ enabled: true, publicUrl: "https://kanna.example.dev" }, true)

    const rendered = await renderClientMarkup(<RemoteMcpSection state={STATE} />)

    expect(rendered.html).not.toContain("Set --password")
    expect(rendered.html).toContain("https://kanna.example.dev/mcp")
    for (const title of ["Claude Code", "Codex", "Claude Desktop and claude.ai", "ChatGPT"]) {
      expect(rendered.html).toContain(title)
    }
    expect(rendered.html).toContain("claude mcp add --transport http kanna https://kanna.example.dev/mcp")
    expect(rendered.html).not.toContain("secret")
    await rendered.cleanup()
  })

  test("the enable switch reflects the saved setting", async () => {
    seed({ enabled: false, publicUrl: null }, true)

    const rendered = await renderClientMarkup(<RemoteMcpSection state={STATE} />)

    const selected = rendered.container.querySelector("[aria-checked='true'], [data-state='on'], [aria-pressed='true']")
    expect(selected?.textContent).toBe("Disabled")
    await rendered.cleanup()
  })

  test("mounting reads only stable selectors and does not loop", async () => {
    seed({ enabled: true, publicUrl: null }, true)

    const result = await renderForLoopCheck(<RemoteMcpSection state={STATE} />)

    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})
