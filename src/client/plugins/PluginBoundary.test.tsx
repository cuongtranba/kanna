import { describe, expect, test } from "bun:test"
import { createContext, useContext } from "react"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { PluginBoundary } from "./PluginBoundary"

const ThemeContext = createContext("none")

function ThemedPlugin() {
  return <span data-testid="themed-plugin">{useContext(ThemeContext)}</span>
}

function BrokenPlugin(): never {
  throw new Error("plugin exploded")
}

describe("PluginBoundary", () => {
  test("renders a plugin that reads context provided by the host app", async () => {
    const rendered = await renderForLoopCheck(
      <ThemeContext.Provider value="host-theme">
        <PluginBoundary pluginId="themed">
          <ThemedPlugin />
        </PluginBoundary>
      </ThemeContext.Provider>,
    )
    try {
      expect(document.querySelector("[data-testid='themed-plugin']")?.textContent).toBe("host-theme")
      expect(document.querySelector("[data-testid='plugin-boundary-error:themed']")).toBeNull()
    } finally {
      await rendered.cleanup()
    }
  })

  test("shows the failure fallback when the plugin throws while rendering", async () => {
    const rendered = await renderForLoopCheck(
      <PluginBoundary pluginId="broken">
        <BrokenPlugin />
      </PluginBoundary>,
    )
    try {
      expect(document.querySelector("[data-testid='plugin-boundary-error:broken']")?.textContent).toContain("broken")
    } finally {
      await rendered.cleanup()
    }
  })
})
