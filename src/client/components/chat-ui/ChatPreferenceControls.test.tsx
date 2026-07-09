import { beforeEach, describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { act, createElement } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { PROVIDERS } from "../../../shared/types"
import { ChatPreferenceControls } from "./ChatPreferenceControls"

describe("ChatPreferenceControls", () => {
  test("renders codex-specific controls and can omit plan mode", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={PROVIDERS}
        selectedProvider="codex"
        model="gpt-5.3-codex"
        modelOptions={{ reasoningEffort: "xhigh", fastMode: true }}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onModelOptionChange={() => {}}
        includePlanMode={false}
      />
    )

    expect(html).toContain("Codex")
    expect(html).toContain("GPT-5.3 Codex")
    expect(html).toContain("XHigh")
    expect(html).toContain("Fast Mode")
    expect(html).not.toContain("Plan Mode")
  })

  test("renders claude plan mode controls when enabled", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={PROVIDERS}
        selectedProvider="claude"
        model="claude-opus-4-7"
        modelOptions={{ reasoningEffort: "max", contextWindow: "1m" }}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onModelOptionChange={() => {}}
        planMode
        onPlanModeChange={() => {}}
        includePlanMode
      />
    )

    expect(html).toContain("Claude")
    expect(html).toContain("Opus 4.7")
    expect(html).toContain("Max")
    expect(html).toContain("1M")
    expect(html).toContain("Plan Mode")
  })

  test("preference popover triggers carry mobile-friendly tap affordances", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={PROVIDERS}
        selectedProvider="claude"
        model="claude-opus-4-7"
        modelOptions={{ reasoningEffort: "high", contextWindow: "1m" }}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onModelOptionChange={() => {}}
        planMode={false}
        onPlanModeChange={() => {}}
      />
    )
    // Every InputPopover trigger should have at least one min-h-[36px] +
    // touch-manipulation pair so taps register reliably on mobile.
    expect(html).toContain("min-h-[36px]")
    expect(html).toContain("touch-manipulation")
  })

  describe("advisor picker hint", () => {
    beforeEach(() => { document.body.innerHTML = "" })

    test("opening the advisor picker (claude SDK) reveals the experimental/rank hint", async () => {
      const container = document.createElement("div")
      document.body.appendChild(container)
      try {
        await act(async () => {
          createRoot(container).render(
            createElement(ChatPreferenceControls, {
              availableProviders: PROVIDERS,
              selectedProvider: "claude",
              model: "claude-opus-4-7",
              modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
              onProviderChange: () => {},
              onModelChange: () => {},
              onModelOptionChange: () => {},
              onAdvisorModelChange: () => {},
            }),
          )
        })
        // The advisor trigger carries the "No Advisor" label when unset.
        const trigger = Array.from(container.querySelectorAll("button"))
          .find((b) => (b.textContent ?? "").includes("No Advisor"))
        expect(trigger).toBeTruthy()
        await act(async () => { trigger!.click() })
        // Radix portals popover content to document.body.
        expect(document.body.textContent ?? "").toContain("Advisor must rank")
      } finally {
        container.remove()
      }
    })
  })
})
