import { afterEach, describe, expect, test } from "vite-plus/test"
import { act } from "react"
import { defaultAppSettingsSnapshot } from "../../../server/app-settings"
import type { RemoteMcpSettings } from "../../../shared/settings/remote-mcp"
import type { AppSettingsPatch } from "../../../shared/app-settings-types"
import { makeFakeDomPort } from "../../lib/testing/fakePorts"
import { renderClientMarkup } from "../../lib/testing/renderClientMarkup"
import { waitFor } from "../../lib/testing/waitFor"
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

  test("behind an https host with no public url it warns that clients are sent to the loopback address", async () => {
    seed({ enabled: true, publicUrl: null }, true)

    const rendered = await renderClientMarkup(
      <RemoteMcpSection state={STATE} dom={makeFakeDomPort({ href: "https://kanna.example.com/settings/remote-mcp" })} />,
    )

    expect(rendered.html).toContain("127.0.0.1")
    expect(rendered.html).toContain("Use https://kanna.example.com")
    await rendered.cleanup()
  })

  test("the warning's button saves the page origin as the public url", async () => {
    seed({ enabled: true, publicUrl: null }, true)
    const written: AppSettingsPatch[] = []
    const state = {
      handleWriteAppSettings: async (patch: AppSettingsPatch) => {
        written.push(patch)
      },
    }

    const rendered = await renderClientMarkup(
      <RemoteMcpSection state={state} dom={makeFakeDomPort({ href: "https://kanna.example.com/chat/c1" })} />,
    )
    const button = Array.from(rendered.container.querySelectorAll("button")).find((candidate) =>
      candidate.textContent?.includes("Use https://kanna.example.com"),
    )
    await act(async () => button?.click())
    await waitFor(() => written.length === 1, 2000, "the public url write")

    expect(written[0]).toEqual({ remoteMcp: { publicUrl: "https://kanna.example.com" } })
    await rendered.cleanup()
  })

  test("a saved public url or a loopback page needs no warning", async () => {
    seed({ enabled: true, publicUrl: "https://kanna.example.dev" }, true)
    const saved = await renderClientMarkup(
      <RemoteMcpSection state={STATE} dom={makeFakeDomPort({ href: "https://kanna.example.com/" })} />,
    )
    expect(saved.html).not.toContain("Use https://")
    await saved.cleanup()

    seed({ enabled: true, publicUrl: null }, true)
    const local = await renderClientMarkup(
      <RemoteMcpSection state={STATE} dom={makeFakeDomPort({ href: "http://localhost:5174/" })} />,
    )
    expect(local.html).not.toContain("Use http")
    await local.cleanup()
  })
})
