import { describe, expect, test } from "vite-plus/test"
import {
  encodeCustomModelId,
  isConfiguredCustomModel,
  parseCustomModelId,
  withCustomProviders,
  type CustomProviderPublic,
} from "./custom-providers"
import { PROVIDERS } from "./provider-model-types"

const GLM: CustomProviderPublic = {
  id: "glm",
  label: "GLM (Z.AI)",
  baseUrl: "https://api.z.ai/api/anthropic",
  apiKeyHint: "9f3a",
  models: [{ id: "glm-5.3", label: "GLM-5.3" }, { id: "glm-5.3-flash", label: "" }],
  createdAt: 1,
  updatedAt: 1,
}

describe("custom model ids", () => {
  test("a vendor model id containing slashes and colons survives an encode and parse round trip", () => {
    const encoded = encodeCustomModelId("glm", "acme/glm-5.3:fast")

    expect(parseCustomModelId(encoded)).toEqual({ providerId: "glm", vendorModel: "acme/glm-5.3:fast" })
  })

  test("an id that is not endpoint-qualified does not parse", () => {
    expect(parseCustomModelId("glm-5.3")).toBeNull()
    expect(parseCustomModelId("/glm-5.3")).toBeNull()
    expect(parseCustomModelId("Bad Id/glm-5.3")).toBeNull()
    expect(parseCustomModelId("glm/")).toBeNull()
  })

  test("only a model the provider lists counts as configured", () => {
    expect(isConfiguredCustomModel([GLM], "glm/glm-5.3")).toBe(true)
    expect(isConfiguredCustomModel([GLM], "glm/glm-9")).toBe(false)
    expect(isConfiguredCustomModel([GLM], "kimi/glm-5.3")).toBe(false)
  })
})

describe("withCustomProviders", () => {
  test("removes the custom entry from the catalog when no provider has models", () => {
    const withoutModels = { ...GLM, models: [] }

    expect(withCustomProviders([...PROVIDERS], []).some((entry) => entry.id === "custom")).toBe(false)
    expect(withCustomProviders([...PROVIDERS], [withoutModels]).some((entry) => entry.id === "custom")).toBe(false)
  })

  test("fills the custom entry with endpoint-qualified models labelled by provider and defaults to the first", () => {
    const custom = withCustomProviders([...PROVIDERS], [GLM]).find((entry) => entry.id === "custom")

    expect(custom?.defaultModel).toBe("glm/glm-5.3")
    expect(custom?.models).toEqual([
      { id: "glm/glm-5.3", label: "GLM (Z.AI) · GLM-5.3" },
      { id: "glm/glm-5.3-flash", label: "GLM (Z.AI) · glm-5.3-flash" },
    ])
  })
})
