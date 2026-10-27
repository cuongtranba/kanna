import { describe, expect, test, vi } from "vite-plus/test"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import { SubagentsSection, type SubagentsSectionHandlers } from "./SubagentsSection"
import {
  DEFAULT_OPENROUTER_SDK_MODEL,
  mergeCustomModels,
  PROVIDERS,
  type ChatProviderPreferences,
  type CustomModelEntry,
  type ProviderCatalogEntry,
  type Subagent,
  type SubagentInput,
} from "../../shared/types"

function closeRoot(root: Root, container: HTMLElement) {
  act(() => {
    root.unmount()
  })
  container.remove()
}

const BASE_PROVIDERS: ProviderCatalogEntry[] = [...PROVIDERS]

function noopHandlers(): SubagentsSectionHandlers {
  return {
    onCreate: vi.fn(async () => ({ ok: true as const, subagent: makeSubagent() })),
    onUpdate: vi.fn(async () => ({ ok: true as const, subagent: makeSubagent() })),
    onDelete: vi.fn(async () => undefined),
  }
}

function makeSubagent(over: Partial<Subagent> = {}): Subagent {
  return {
    id: "sa-1",
    name: "reviewer",
    description: "code reviewer",
    provider: "claude",
    model: "claude-sonnet-4-6",
    modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
    systemPrompt: "Review carefully.",
    contextScope: "previous-assistant-reply",
    triggerMode: "auto",
    createdAt: 100,
    updatedAt: 200,
    ...over,
  }
}

const defaultProviderPrefs: ChatProviderPreferences = {
  claude: {
    model: "claude-sonnet-4-6",
    modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
    planMode: false,
  },
  codex: {
    model: "gpt-5.5",
    modelOptions: { reasoningEffort: "high", fastMode: false },
    planMode: false,
  },
  openrouter: {
    model: DEFAULT_OPENROUTER_SDK_MODEL,
    modelOptions: {},
    planMode: false,
  },
  custom: {
    model: "",
    modelOptions: {},
    planMode: false,
  },
}

async function mountSubagentsSection(props: {
  subagents: Subagent[]
  providerDefaults?: ChatProviderPreferences
  editing?: { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string }
  handlers?: SubagentsSectionHandlers
  availableProviders?: ProviderCatalogEntry[]
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  await act(async () => {
    root.render(
      <SubagentsSection
        subagents={props.subagents}
        providerDefaults={props.providerDefaults ?? defaultProviderPrefs}
        editing={props.editing ?? { kind: "list" }}
        onSelect={() => undefined}
        onStartCreate={() => undefined}
        onCancelEditing={() => undefined}
        handlers={props.handlers ?? noopHandlers()}
        availableProviders={props.availableProviders ?? BASE_PROVIDERS}
      />,
    )
  })
  return { container, cleanup: () => { closeRoot(root, container) } }
}

describe("SubagentsSection — empty state", () => {
  test("renders empty CTA when no subagents", async () => {
    const { container, cleanup } = await mountSubagentsSection({ subagents: [] })
    expect(container.textContent).toContain("No subagents yet")
    expect(container.textContent).toContain("Create subagent")
    cleanup()
  })

  test("clicking Create subagent calls onStartCreate", async () => {
    const onStartCreate = vi.fn(() => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentsSection
          subagents={[]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "list" }}
          onSelect={() => undefined}
          onStartCreate={onStartCreate}
          onCancelEditing={() => undefined}
          handlers={noopHandlers()}
          availableProviders={BASE_PROVIDERS}
        />,
      )
    })
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Create subagent",
    )
    expect(btn).toBeDefined()
    await act(async () => { btn!.click() })
    expect(onStartCreate).toHaveBeenCalledTimes(1)
    closeRoot(root, container)
  })
})

describe("SubagentsSection — create form", () => {
  test("renders empty form when editing.kind === 'create'", async () => {
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [],
      editing: { kind: "create" },
    })
    const nameInput = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-name']")
    expect(nameInput).toBeDefined()
    expect(nameInput?.value).toBe("")
    expect(container.textContent).toContain("System prompt")
    expect(container.textContent).toContain("Save")
    expect(container.textContent).toContain("Cancel")
    cleanup()
  })

  test("Save button disabled when name is empty", async () => {
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [],
      editing: { kind: "create" },
    })
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")
    expect(save).toBeDefined()
    expect(save?.disabled).toBe(true)
    cleanup()
  })

  test("Cancel calls onCancelEditing", async () => {
    const onCancelEditing = vi.fn(() => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentsSection
          subagents={[]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "create" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={onCancelEditing}
          handlers={noopHandlers()}
          availableProviders={BASE_PROVIDERS}
        />,
      )
    })
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel",
    )
    expect(cancel).toBeDefined()
    await act(async () => { cancel!.click() })
    expect(onCancelEditing).toHaveBeenCalledTimes(1)
    closeRoot(root, container)
  })

  test("custom model from settings appears in Model dropdown", async () => {
    const customEntry: CustomModelEntry = {
      id: "claude-custom-preview",
      provider: "claude",
      label: "Claude Custom Preview",
      createdAt: 0,
      updatedAt: 0,
    }
    const availableProviders = mergeCustomModels(BASE_PROVIDERS, [customEntry])
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [],
      editing: { kind: "create" },
      availableProviders,
    })
    const trigger = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-model']")!
    await act(async () => { trigger.click() })
    expect(document.body.textContent).toContain("Claude Custom Preview")
    cleanup()
  })

  test("name input enforces maxLength cap", async () => {
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [],
      editing: { kind: "create" },
    })
    const nameInput = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-name']")!
    expect(nameInput.maxLength).toBe(64)
    cleanup()
  })
})

describe("SubagentsSection — edit form", () => {
  test("loads subject values into form fields", async () => {
    const subagent = makeSubagent({ id: "sa-9", name: "auditor", systemPrompt: "Audit hard." })
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [subagent],
      editing: { kind: "edit", id: "sa-9" },
    })
    const nameInput = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-name']")!
    expect(nameInput.value).toBe("auditor")
    const prompt = container.querySelector<HTMLTextAreaElement>("[data-testid='subagent-form-system-prompt']")!
    expect(prompt.value).toBe("Audit hard.")
    cleanup()
  })

  test("save with no dirty changes is disabled", async () => {
    const subagent = makeSubagent({ id: "sa-9" })
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [subagent],
      editing: { kind: "edit", id: "sa-9" },
    })
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    expect(save.disabled).toBe(true)
    cleanup()
  })

  test("server validation error renders under name field", async () => {
    const subagent = makeSubagent({ id: "sa-9", name: "auditor" })
    const handlers: SubagentsSectionHandlers = {
      onCreate: vi.fn(async () => ({ ok: false as const, error: { code: "DUPLICATE_NAME" as const, message: "Name already used" } })),
      onUpdate: vi.fn(async () => ({ ok: false as const, error: { code: "DUPLICATE_NAME" as const, message: "Name already used" } })),
      onDelete: vi.fn(async () => undefined),
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentsSection
          subagents={[subagent]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "edit", id: "sa-9" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={handlers}
          availableProviders={BASE_PROVIDERS}
        />,
      )
    })
    const desc = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-description'] ")!
    expect(desc).toBeDefined()
    const fullTranscriptBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Full transcript",
    )!
    await act(async () => { fullTranscriptBtn.click() })
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    expect(save.disabled).toBe(false)
    await act(async () => { save.click() })
    expect(container.textContent).toContain("Name already used")
    expect(handlers.onUpdate).toHaveBeenCalledTimes(1)
    closeRoot(root, container)
  })
})

describe("SubagentsSection — trigger mode control", () => {
  test("switching to Manual makes form dirty and Save enabled", async () => {
    const subagent = makeSubagent({ id: "sa-9", triggerMode: "auto" })
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [subagent],
      editing: { kind: "edit", id: "sa-9" },
    })
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    expect(save.disabled).toBe(true)
    const manualBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Manual",
    )
    expect(manualBtn).toBeDefined()
    await act(async () => { manualBtn!.click() })
    expect(save.disabled).toBe(false)
    cleanup()
  })
})

describe("SubagentsSection — delete confirm", () => {
  test("first click flips Delete to 'Confirm delete', second click calls onDelete", async () => {
    const onDelete = vi.fn(async (_id: string) => undefined)
    const handlers: SubagentsSectionHandlers = {
      ...noopHandlers(),
      onDelete,
    }
    const subagent = makeSubagent({ id: "sa-1" })
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentsSection
          subagents={[subagent]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "edit", id: "sa-1" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={handlers}
          availableProviders={BASE_PROVIDERS}
        />,
      )
    })
    const deleteBtn = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-delete']")!
    expect(deleteBtn.textContent?.trim()).toBe("Delete")
    await act(async () => { deleteBtn.click() })
    expect(onDelete).not.toHaveBeenCalled()
    const flipped = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-delete']")!
    expect(flipped.textContent?.trim()).toBe("Confirm delete")
    await act(async () => { flipped.click() })
    expect(onDelete).toHaveBeenCalledWith("sa-1")
    closeRoot(root, container)
  })
})

describe("SubagentsSection — list rendering", () => {
  test("lists subagent names with provider chip", async () => {
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [
        makeSubagent({ id: "sa-1", name: "reviewer", provider: "claude" }),
        makeSubagent({ id: "sa-2", name: "auditor", provider: "codex", model: "gpt-5.5", modelOptions: { reasoningEffort: "high", fastMode: false } }),
      ],
    })
    expect(container.textContent).toContain("reviewer")
    expect(container.textContent).toContain("auditor")
    expect(container.textContent).toContain("Claude")
    expect(container.textContent).toContain("Codex")
    cleanup()
  })

  test("clicking a list row calls onSelect with id", async () => {
    const onSelect = vi.fn((_id: string) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    const root = createRoot(container)
    await act(async () => {
      root.render(
        <SubagentsSection
          subagents={[makeSubagent({ id: "sa-1", name: "reviewer" })]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "list" }}
          onSelect={onSelect}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={noopHandlers()}
          availableProviders={BASE_PROVIDERS}
        />,
      )
    })
    const row = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("data-testid") === "subagent-row:sa-1",
    )
    expect(row).toBeDefined()
    await act(async () => { row!.click() })
    expect(onSelect).toHaveBeenCalledWith("sa-1")
    closeRoot(root, container)
  })
})

describe("SubagentsSection — beacon tools grant", () => {
  function recordingHandlers(): { handlers: SubagentsSectionHandlers; saved: SubagentInput[] } {
    const saved: SubagentInput[] = []
    const handlers: SubagentsSectionHandlers = {
      ...noopHandlers(),
      onUpdate: async (_id, input) => {
        saved.push(input)
        return { ok: true as const, subagent: makeSubagent() }
      },
    }
    return { handlers, saved }
  }

  async function mountEditing(subagent: Subagent, handlers: SubagentsSectionHandlers) {
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [subagent],
      editing: { kind: "edit", id: subagent.id },
      handlers,
    })
    const checkbox = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-allow-beacon-tools']")!
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    return { container, cleanup, checkbox, save }
  }

  test("an ungranted subagent shows the box unchecked and granting it saves allowBeaconTools true", async () => {
    const { handlers, saved } = recordingHandlers()
    const { checkbox, save, cleanup } = await mountEditing(makeSubagent({ id: "sa-9" }), handlers)
    expect(checkbox.checked).toBe(false)
    expect(save.disabled).toBe(true)
    await act(async () => { checkbox.click() })
    expect(save.disabled).toBe(false)
    await act(async () => { save.click() })
    expect(saved.map((input) => input.allowBeaconTools)).toEqual([true])
    cleanup()
  })

  test("a granted subagent shows the box checked and revoking it saves allowBeaconTools false", async () => {
    const { handlers, saved } = recordingHandlers()
    const { checkbox, save, cleanup } = await mountEditing(
      makeSubagent({ id: "sa-9", allowBeaconTools: true }),
      handlers,
    )
    expect(checkbox.checked).toBe(true)
    await act(async () => { checkbox.click() })
    await act(async () => { save.click() })
    expect(saved.map((input) => input.allowBeaconTools)).toEqual([false])
    cleanup()
  })
})
