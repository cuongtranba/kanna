import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PROVIDERS } from "../../../shared/types"
import { withCustomProviders, type CustomProviderPublic } from "../../../shared/custom-providers"
import { ChatPreferenceControls } from "./ChatPreferenceControls"

const GLM: CustomProviderPublic = {
  id: "glm",
  label: "GLM",
  baseUrl: "https://api.z.ai/api/anthropic",
  apiKeyHint: "abcd",
  models: [{ id: "glm-5.3", label: "GLM-5.3" }],
  createdAt: 0,
  updatedAt: 0,
}

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
    expect(html).toContain("min-h-[36px]")
    expect(html).toContain("touch-manipulation")
  })

  test("locks model picker when onModelChange is omitted", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={PROVIDERS}
        selectedProvider="claude"
        model="claude-opus-4-7"
        modelOptions={{ reasoningEffort: "high", contextWindow: "1m" }}
        onProviderChange={() => {}}
        onModelOptionChange={() => {}}
      />
    )
    expect(html).toContain("Opus 4.7")
    expect(html).toContain("aria-disabled")
    expect(html).toContain("lucide-lock")
  })
  test("custom endpoints use the model picker without reasoning, context or fast controls", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={withCustomProviders([...PROVIDERS], [GLM])}
        selectedProvider="custom"
        model="glm/glm-5.3"
        modelOptions={{}}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onModelOptionChange={() => {}}
      />
    )

    expect(html).toContain("Custom endpoints")
    expect(html).toContain("GLM · GLM-5.3")
    expect(html).not.toContain("Fast Mode")
    expect(html).not.toContain("High")
  })

  test("renders instead of throwing when the selected provider is not offered", () => {
    const html = renderToStaticMarkup(
      <ChatPreferenceControls
        availableProviders={PROVIDERS.filter((provider) => provider.id === "claude")}
        selectedProvider="custom"
        model="glm/glm-5.3"
        modelOptions={{}}
        onProviderChange={() => {}}
        onModelChange={() => {}}
        onModelOptionChange={() => {}}
      />
    )

    expect(html).toContain("Claude")
  })
})
