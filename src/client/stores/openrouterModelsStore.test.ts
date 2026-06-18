import { describe, it, expect, beforeEach } from "bun:test"
import { useOpenRouterModelsStore } from "./openrouterModelsStore"

describe("openrouterModelsStore", () => {
  beforeEach(() => {
    useOpenRouterModelsStore.setState({ models: [], status: "idle", error: null })
  })

  it("starts idle with empty models", () => {
    const s = useOpenRouterModelsStore.getState()
    expect(s.status).toBe("idle")
    expect(s.models).toEqual([])
    expect(s.error).toBeNull()
  })

  it("setLoading transitions to loading + clears error", () => {
    useOpenRouterModelsStore.setState({ status: "error", error: "boom" })
    useOpenRouterModelsStore.getState().setLoading()
    const s = useOpenRouterModelsStore.getState()
    expect(s.status).toBe("loading")
    expect(s.error).toBeNull()
  })

  it("setModels populates list + flips to ready", () => {
    useOpenRouterModelsStore.getState().setModels([
      { id: "openai/gpt-5", label: "GPT-5", contextLength: 200000 },
    ])
    const s = useOpenRouterModelsStore.getState()
    expect(s.status).toBe("ready")
    expect(s.models).toHaveLength(1)
    expect(s.error).toBeNull()
  })

  it("setError flips to error with message", () => {
    useOpenRouterModelsStore.getState().setError("fetch failed")
    const s = useOpenRouterModelsStore.getState()
    expect(s.status).toBe("error")
    expect(s.error).toBe("fetch failed")
  })
})
