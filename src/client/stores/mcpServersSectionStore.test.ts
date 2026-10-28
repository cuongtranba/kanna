import { test, expect, describe, beforeEach } from "vite-plus/test"
import { useMcpServersSectionStore } from "./mcpServersSectionStore"
import type { McpServerConfig } from "../../shared/types"

const httpServer: McpServerConfig = {
  id: "design",
  name: "design",
  enabled: true,
  createdAt: "",
  updatedAt: "",
  lastTest: { status: "untested" },
  transport: "http",
  url: "https://example.com/mcp",
  headers: { "X-Team": "kanna" },
  oauth: { enabled: true, status: "authenticated" },
}

beforeEach(() => {
  const store = useMcpServersSectionStore.getState()
  store.setEditing({ kind: "list" })
  store.resetEditorForm(null)
})

describe("mcpServersSectionStore — editor form", () => {
  test("resetEditorForm derives the whole draft from the server config", () => {
    useMcpServersSectionStore.getState().patchEditorForm({ name: "stale", error: "stale" })
    useMcpServersSectionStore.getState().resetEditorForm(httpServer)

    const form = useMcpServersSectionStore.getState().editorForm
    expect(form.name).toBe("design")
    expect(form.transport).toBe("http")
    expect(form.url).toBe("https://example.com/mcp")
    expect(form.headersText).toBe("X-Team: kanna")
    expect(form.oauthEnabled).toBe(true)
    expect(form.error).toBeNull()
  })

  test("patchEditorForm merges without disturbing untouched fields", () => {
    useMcpServersSectionStore.getState().resetEditorForm(httpServer)
    useMcpServersSectionStore.getState().patchEditorForm({ url: "https://other.example/mcp" })

    const form = useMcpServersSectionStore.getState().editorForm
    expect(form.url).toBe("https://other.example/mcp")
    expect(form.name).toBe("design")
    expect(form.headersText).toBe("X-Team: kanna")
  })

  test("disabling OAuth clears the whole flow in one patch", () => {
    useMcpServersSectionStore.getState().resetEditorForm(httpServer)
    useMcpServersSectionStore
      .getState()
      .patchEditorForm({ authFlowUrl: "https://auth.example/authorize", callbackInput: "code=1" })

    useMcpServersSectionStore.getState().patchEditorForm({
      oauthEnabled: false,
      authFlowUrl: null,
      callbackInput: "",
      oauthError: null,
    })

    const form = useMcpServersSectionStore.getState().editorForm
    expect(form.oauthEnabled).toBe(false)
    expect(form.authFlowUrl).toBeNull()
    expect(form.callbackInput).toBe("")
    expect(form.name).toBe("design")
  })
})
