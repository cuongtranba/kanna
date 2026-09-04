import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { MemoryRouter, Outlet, Route, Routes } from "react-router-dom"
import { SettingsPage } from "./SettingsPage"
import { ThemeProvider } from "../hooks/useTheme"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { usePreferencesStore } from "../stores/preferences"
import type { KannaState } from "./useKannaState"
import type { AppSettingsPatch } from "../../shared/types"

/**
 * P7 regression guard: `scripts/verify-session-tabs.sh` exists because a
 * blank-white-page regression once shipped with every test green — every one
 * of them mounted a page component by hand instead of through the real
 * router. `SettingsPage` calls `useOutletContext` and `useTheme()`, both of
 * which throw when the component is mounted standalone, so this test drives
 * it the way the app actually does: `MemoryRouter` -> `Routes` -> a layout
 * route rendering `<Outlet context={...}/>` -> `ThemeProvider` -> the real
 * `/settings/:sectionId` route.
 */

interface Harness {
  container: HTMLDivElement
  unmount: () => void
}

function fakeState(overrides: Partial<KannaState> = {}): KannaState {
  return {
    socket: {
      command: async () => undefined,
      subscribe: () => () => undefined,
    },
    connectionStatus: "connected",
    localProjectsReady: true,
    localProjects: null,
    updateSnapshot: null,
    keybindings: null,
    appSettings: null,
    llmProvider: null,
    pushConfig: null,
    editorLabel: "VS Code",
    openSidebar: () => undefined,
    handleOpenExternalPath: async () => undefined,
    handleWriteAppSettings: async () => undefined,
    handleWriteCloudflareTunnel: async () => undefined,
    handleWriteClaudeAuth: async () => undefined,
    handleTestOAuthToken: async () => ({ ok: true, error: null }),
    handleReadLlmProvider: async () => undefined,
    handleWriteLlmProvider: async () => undefined,
    handleValidateLlmProvider: async () => ({ ok: true }),
    handleSignOut: async () => undefined,
    ...overrides,
  } as unknown as KannaState
}

async function mount(state: KannaState): Promise<Harness> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <ThemeProvider>
        <MemoryRouter initialEntries={["/settings/general"]}>
          <Routes>
            <Route path="/" element={<Outlet context={state} />}>
              <Route path="settings/:sectionId" element={<SettingsPage />} />
            </Route>
          </Routes>
        </MemoryRouter>
      </ThemeProvider>,
    )
  })
  return {
    container,
    unmount: () => {
      act(() => root.unmount())
      container.remove()
    },
  }
}

function findTrigger(container: HTMLElement, textFragment: string): HTMLElement {
  const found = [...container.querySelectorAll<HTMLElement>('[role="combobox"]')].find((node) =>
    (node.textContent ?? "").includes(textFragment),
  )
  if (!found) throw new Error(`no combobox containing "${textFragment}" in: ${container.textContent ?? ""}`)
  return found
}

function findOption(text: string): HTMLElement {
  const found = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((node) => node.textContent === text)
  if (!found) throw new Error(`no "${text}" option rendered`)
  return found
}

function findButton(container: HTMLElement, text: string): HTMLElement {
  const found = [...container.querySelectorAll("button")].find((node) => (node.textContent ?? "").includes(text))
  if (!found) throw new Error(`no "${text}" button in: ${container.textContent ?? ""}`)
  return found
}

beforeEach(() => {
  usePreferencesStore.setState({ typographyOverride: undefined, typographyServerDefaultCache: undefined })
  useAppSettingsStore.setState({ settings: null, hydrationStatus: "idle" })
})

afterEach(() => {
  usePreferencesStore.setState({ typographyOverride: undefined, typographyServerDefaultCache: undefined })
  useAppSettingsStore.setState({ settings: null, hydrationStatus: "idle" })
})

describe("SettingsPage typography row (real router)", () => {
  test("renders the account default typography scale through the real /settings/general route", async () => {
    const harness = await mount(fakeState())

    expect(harness.container.textContent).toContain("Typography Scale")
    // No device override and no server value yet -> falls back to "md" ("Default").
    findTrigger(harness.container, "Default")

    harness.unmount()
  })

  test("selecting a new scale writes it through handleWriteAppSettings as the typography group", async () => {
    const writes: unknown[] = []
    const harness = await mount(
      fakeState({
        handleWriteAppSettings: async (patch: AppSettingsPatch) => {
          writes.push(patch)
        },
      }),
    )

    const trigger = findTrigger(harness.container, "Default")
    await act(async () => {
      trigger.click()
    })
    const option = findOption("Large")
    await act(async () => {
      option.click()
    })

    expect(writes).toEqual([{ typography: { scale: "lg" } }])

    harness.unmount()
  })

  test("indicates a device override and offers a reset to the account default", async () => {
    usePreferencesStore.setState({ typographyOverride: "xxl" })
    const harness = await mount(fakeState())

    expect(harness.container.textContent).toContain("This device uses its own text size")
    findTrigger(harness.container, "XX-Large")
    const resetButton = findButton(harness.container, "Use account default")

    await act(async () => {
      resetButton.click()
    })

    expect(usePreferencesStore.getState().typographyOverride).toBeUndefined()

    harness.unmount()
  })
})
