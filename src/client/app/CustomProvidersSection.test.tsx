import { afterEach, beforeEach, describe, expect, test } from "bun:test"
import { act } from "react"
import { renderClientMarkup } from "../lib/testing/renderClientMarkup"
import { renderForLoopCheck } from "../lib/testing/renderForLoopCheck"
import { makeFakeDomPort } from "../adapters/testing/makeFakePorts"
import { useCustomProvidersSectionStore } from "../stores/customProvidersSectionStore"
import type { AppSettingsPatch } from "../../shared/types"
import type { CustomProviderInput, CustomProviderPatch, CustomProviderPublic } from "../../shared/custom-providers"
import {
  CustomProvidersSection,
  CustomProvidersSettingsBranch,
  type CustomProvidersHandlers,
} from "./CustomProvidersSection"

const GLM_KEY = "sk-test-0000-abcd"

function provider(over: Partial<CustomProviderPublic> = {}): CustomProviderPublic {
  return {
    id: "glm",
    label: "GLM (Z.AI)",
    baseUrl: "https://api.z.ai/api/anthropic",
    apiKeyHint: "abcd",
    models: [
      { id: "glm-5.3", label: "GLM-5.3" },
      { id: "glm-5.3-flash", label: "" },
    ],
    createdAt: 0,
    updatedAt: 0,
    ...over,
  }
}

interface Recorded {
  created: CustomProviderInput[]
  updated: Array<{ id: string; patch: CustomProviderPatch }>
  deleted: string[]
}

function recordingHandlers(over: Partial<CustomProvidersHandlers> = {}): { handlers: CustomProvidersHandlers; recorded: Recorded } {
  const recorded: Recorded = { created: [], updated: [], deleted: [] }
  const handlers: CustomProvidersHandlers = {
    onCreate: async (input) => { recorded.created.push(input) },
    onUpdate: async (id, patch) => { recorded.updated.push({ id, patch }) },
    onDelete: async (id) => { recorded.deleted.push(id) },
    ...over,
  }
  return { handlers, recorded }
}

function resetSectionStore() {
  useCustomProvidersSectionStore.getState().discardEditor()
  useCustomProvidersSectionStore.getState().setListError(null)
}

beforeEach(resetSectionStore)
afterEach(resetSectionStore)

function typeInto(el: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  setter?.call(el, value)
  el.dispatchEvent(new Event("input", { bubbles: true }))
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll("button")].find((candidate) => candidate.textContent?.includes(text))
  expect(button).toBeDefined()
  return button as HTMLButtonElement
}

function click(button: HTMLElement) {
  return act(async () => {
    button.click()
  })
}

function passwordInput(root: ParentNode): HTMLInputElement {
  const input = root.querySelector<HTMLInputElement>('input[type="password"]')
  expect(input).not.toBeNull()
  return input as HTMLInputElement
}

function openPresetMenu() {
  return act(async () => {
    useCustomProvidersSectionStore.getState().setMenuOpen(true)
  })
}

describe("CustomProvidersSection list", () => {
  test("shows each endpoint with its model count and key status but never a key value", async () => {
    const { handlers } = recordingHandlers()
    const view = await renderClientMarkup(
      <CustomProvidersSection
        providers={[provider(), provider({ id: "kimi", label: "Kimi", apiKeyHint: null, models: [{ id: "kimi-k3", label: "Kimi K3" }] })]}
        handlers={handlers}
      />,
    )

    const text = view.container.textContent ?? ""
    expect(text).toContain("GLM (Z.AI)")
    expect(text).toContain("https://api.z.ai/api/anthropic")
    expect(text).toContain("2 models")
    expect(text).toContain("1 model")
    expect(text).toContain("Key ••••abcd")
    expect(text).toContain("Key set")
    expect(text).not.toMatch(/sk-[A-Za-z0-9]/)
    expect(view.container.querySelector('input[type="password"]')).toBeNull()
    await view.cleanup()
  })

  test("explains the empty state", async () => {
    const { handlers } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[]} handlers={handlers} />)

    expect(view.container.textContent).toContain("No custom endpoints yet.")
    await view.cleanup()
  })

  test("deleting asks first and sends the provider id once confirmed", async () => {
    const { handlers, recorded } = recordingHandlers()
    const dom = makeFakeDomPort()
    dom.confirmResult = false
    const view = await renderClientMarkup(<CustomProvidersSection providers={[provider()]} handlers={handlers} dom={dom} />)

    await click(view.container.querySelector<HTMLButtonElement>('[aria-label="Delete GLM (Z.AI)"]') as HTMLButtonElement)
    expect(recorded.deleted).toEqual([])

    dom.confirmResult = true
    await click(view.container.querySelector<HTMLButtonElement>('[aria-label="Delete GLM (Z.AI)"]') as HTMLButtonElement)
    expect(recorded.deleted).toEqual(["glm"])
    await view.cleanup()
  })

  test("a failed delete is shown to the user", async () => {
    const { handlers } = recordingHandlers({
      onDelete: async () => {
        throw new Error("settings file is read-only")
      },
    })
    const view = await renderClientMarkup(
      <CustomProvidersSection providers={[provider()]} handlers={handlers} dom={makeFakeDomPort()} />,
    )

    await click(view.container.querySelector<HTMLButtonElement>('[aria-label="Delete GLM (Z.AI)"]') as HTMLButtonElement)

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("settings file is read-only")
    await view.cleanup()
  })
})

describe("CustomProvidersSettingsBranch create flow", () => {
  test("a GLM preset plus a key writes one customProviders.create patch and then forgets the key", async () => {
    const patches: AppSettingsPatch[] = []
    const view = await renderClientMarkup(
      <CustomProvidersSettingsBranch
        state={{ handleWriteAppSettings: async (patch) => { patches.push(patch) } }}
      />,
    )

    await openPresetMenu()
    await click(buttonByText(document.body, "GLM (Z.AI)"))
    expect(view.container.querySelector<HTMLInputElement>('input[placeholder="glm"]')?.value).toBe("glm")

    await act(async () => {
      typeInto(passwordInput(view.container), GLM_KEY)
    })
    await click(buttonByText(view.container, "Add endpoint"))

    expect(patches).toEqual([
      {
        customProviders: {
          create: {
            id: "glm",
            label: "GLM (Z.AI)",
            baseUrl: "https://api.z.ai/api/anthropic",
            apiKey: GLM_KEY,
            models: [
              { id: "glm-5.3", label: "GLM-5.3" },
              { id: "glm-5.3-flash", label: "GLM-5.3 Flash" },
            ],
          },
        },
      },
    ])
    expect(view.container.querySelector('input[type="password"]')).toBeNull()
    expect(useCustomProvidersSectionStore.getState().editorForm.apiKey).toBe("")
    await view.cleanup()
  })

  test("a preset whose id is taken pre-fills the next free id", async () => {
    const { handlers } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[provider()]} handlers={handlers} />)

    await openPresetMenu()
    await click(buttonByText(document.body, "GLM (Z.AI)"))

    expect(view.container.querySelector<HTMLInputElement>('input[placeholder="glm"]')?.value).toBe("glm-2")
    await view.cleanup()
  })

  test("a preset hint is shown in the editor", async () => {
    const { handlers } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[]} handlers={handlers} />)

    await openPresetMenu()
    await click(buttonByText(document.body, "MiniMax"))

    expect(view.container.textContent).toContain("Mainland China: https://api.minimaxi.com/anthropic")
    await view.cleanup()
  })

  test("saving without an API key explains what is missing and sends nothing", async () => {
    const { handlers, recorded } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[]} handlers={handlers} />)

    await openPresetMenu()
    await click(buttonByText(document.body, "Kimi (Moonshot)"))
    await click(buttonByText(view.container, "Add endpoint"))

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("API key")
    expect(recorded.created).toEqual([])
    await view.cleanup()
  })

  test("a rejected save keeps the editor open and shows the server error", async () => {
    const { handlers } = recordingHandlers({
      onCreate: async () => {
        throw new Error("provider 'kimi' already exists")
      },
    })
    const view = await renderClientMarkup(<CustomProvidersSection providers={[]} handlers={handlers} />)

    await openPresetMenu()
    await click(buttonByText(document.body, "Kimi (Moonshot)"))
    await act(async () => {
      typeInto(passwordInput(view.container), GLM_KEY)
    })
    await click(buttonByText(view.container, "Add endpoint"))

    expect(view.container.querySelector('[role="alert"]')?.textContent).toContain("already exists")
    expect(view.container.querySelector('input[type="password"]')).not.toBeNull()
    await view.cleanup()
  })

  test("cancelling discards the typed key", async () => {
    const { handlers } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[]} handlers={handlers} />)

    await openPresetMenu()
    await click(buttonByText(document.body, "DeepSeek"))
    await act(async () => {
      typeInto(passwordInput(view.container), GLM_KEY)
    })
    await click(buttonByText(view.container, "Cancel"))

    expect(useCustomProvidersSectionStore.getState().editorForm.apiKey).toBe("")
    expect(view.container.textContent).toContain("No custom endpoints yet.")
    await view.cleanup()
  })
})

describe("CustomProvidersSection edit flow", () => {
  test("editing with a blank key keeps the stored key by omitting apiKey", async () => {
    const { handlers, recorded } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[provider()]} handlers={handlers} />)

    await click(view.container.querySelector<HTMLButtonElement>('[aria-label="Edit GLM (Z.AI)"]') as HTMLButtonElement)
    expect(passwordInput(view.container).placeholder).toBe("Leave blank to keep ••••abcd")
    expect(view.container.querySelector<HTMLInputElement>('input[placeholder="glm"]')?.disabled).toBe(true)

    await click(buttonByText(view.container, "Save changes"))

    expect(recorded.updated).toEqual([
      {
        id: "glm",
        patch: {
          label: "GLM (Z.AI)",
          baseUrl: "https://api.z.ai/api/anthropic",
          models: [
            { id: "glm-5.3", label: "GLM-5.3" },
            { id: "glm-5.3-flash", label: "" },
          ],
        },
      },
    ])
    expect(recorded.updated[0] && "apiKey" in recorded.updated[0].patch).toBe(false)
    await view.cleanup()
  })

  test("a typed replacement key is sent with the update", async () => {
    const { handlers, recorded } = recordingHandlers()
    const view = await renderClientMarkup(<CustomProvidersSection providers={[provider()]} handlers={handlers} />)

    await click(view.container.querySelector<HTMLButtonElement>('[aria-label="Edit GLM (Z.AI)"]') as HTMLButtonElement)
    await act(async () => {
      typeInto(passwordInput(view.container), "sk-rotated-9999")
    })
    await click(buttonByText(view.container, "Save changes"))

    expect(recorded.updated[0]?.patch.apiKey).toBe("sk-rotated-9999")
    await view.cleanup()
  })
})

describe("CustomProvidersSection render loop", () => {
  test("mounting with a configured endpoint does not loop", async () => {
    const { handlers } = recordingHandlers()
    const result = await renderForLoopCheck(<CustomProvidersSection providers={[provider()]} handlers={handlers} />)

    expect(result.loopWarnings).toEqual([])
    expect(result.thrown).toBeNull()
    await result.cleanup()
  })
})
