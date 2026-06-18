import { describe, expect, mock, test } from "bun:test"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../lib/testing/setupHappyDom"
import {
  createDefaultSubagentDraft,
  isSubagentDraftDirty,
  mapSubagentValidationError,
  sanitizeSubagentNameInput,
  SubagentsSection,
  toSubagentInput,
  type SubagentsSectionHandlers,
} from "./SubagentsSection"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  type ChatProviderPreferences,
  type Subagent,
  type SubagentInput,
} from "../../shared/types"

function noopHandlers(): SubagentsSectionHandlers {
  return {
    onCreate: mock(async () => ({ ok: true as const, subagent: makeSubagent() })),
    onUpdate: mock(async () => ({ ok: true as const, subagent: makeSubagent() })),
    onDelete: mock(async () => undefined),
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
}

const providerDefaults: ChatProviderPreferences = {
  claude: {
    model: "claude-opus-4-7",
    modelOptions: { reasoningEffort: "medium", contextWindow: "1m" },
    planMode: false,
  },
  codex: {
    model: "gpt-5.4",
    modelOptions: { reasoningEffort: "low", fastMode: true },
    planMode: false,
  },
  openrouter: {
    model: DEFAULT_OPENROUTER_SDK_MODEL,
    modelOptions: {},
    planMode: false,
  },
}

describe("createDefaultSubagentDraft", () => {
  test("uses claude provider defaults", () => {
    const draft = createDefaultSubagentDraft("claude", providerDefaults)
    expect(draft.provider).toBe("claude")
    expect(draft.model).toBe("claude-opus-4-7")
    expect(draft.modelOptions).toEqual({ reasoningEffort: "medium", contextWindow: "1m" })
    expect(draft.contextScope).toBe("previous-assistant-reply")
    expect(draft.name).toBe("")
    expect(draft.systemPrompt).toBe("")
  })

  test("uses codex provider defaults", () => {
    const draft = createDefaultSubagentDraft("codex", providerDefaults)
    expect(draft.provider).toBe("codex")
    expect(draft.model).toBe("gpt-5.4")
    expect(draft.modelOptions).toEqual({ reasoningEffort: "low", fastMode: true })
  })

  test("falls back to provider catalog defaults when preferences absent", () => {
    const draft = createDefaultSubagentDraft("claude", undefined)
    expect(draft.model).toBe("claude-sonnet-4-6")
    expect(draft.modelOptions).toEqual(DEFAULT_CLAUDE_MODEL_OPTIONS)
  })

  test("codex fallback to catalog defaults", () => {
    const draft = createDefaultSubagentDraft("codex", undefined)
    expect(draft.model).toBe("gpt-5.5")
    expect(draft.modelOptions).toEqual(DEFAULT_CODEX_MODEL_OPTIONS)
  })
})

describe("toSubagentInput", () => {
  test("strips id/createdAt/updatedAt from existing subagent", () => {
    const subagent: Subagent = {
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
    }
    const input = toSubagentInput(subagent)
    expect(input).toEqual({
      name: "reviewer",
      description: "code reviewer",
      provider: "claude",
      model: "claude-sonnet-4-6",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      systemPrompt: "Review carefully.",
      contextScope: "previous-assistant-reply",
      triggerMode: "auto",
    })
  })
})

describe("isSubagentDraftDirty", () => {
  const baseline: SubagentInput = {
    name: "reviewer",
    description: "code reviewer",
    provider: "claude",
    model: "claude-sonnet-4-6",
    modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
    systemPrompt: "Review carefully.",
    contextScope: "previous-assistant-reply",
  }

  test("returns false when identical", () => {
    expect(isSubagentDraftDirty(baseline, baseline)).toBe(false)
    expect(isSubagentDraftDirty({ ...baseline }, baseline)).toBe(false)
  })

  test("returns true when name differs", () => {
    expect(isSubagentDraftDirty({ ...baseline, name: "auditor" }, baseline)).toBe(true)
  })

  test("returns true when systemPrompt differs", () => {
    expect(isSubagentDraftDirty({ ...baseline, systemPrompt: "Be quick." }, baseline)).toBe(true)
  })

  test("returns true when modelOptions reasoningEffort differs", () => {
    expect(
      isSubagentDraftDirty(
        { ...baseline, modelOptions: { reasoningEffort: "low", contextWindow: "200k" } },
        baseline,
      ),
    ).toBe(true)
  })

  test("returns true when provider differs", () => {
    expect(
      isSubagentDraftDirty(
        {
          ...baseline,
          provider: "codex",
          model: "gpt-5.5",
          modelOptions: { reasoningEffort: "high", fastMode: false },
        },
        baseline,
      ),
    ).toBe(true)
  })
})

describe("mapSubagentValidationError", () => {
  test("name-related codes target the name field", () => {
    for (const code of ["EMPTY_NAME", "INVALID_CHAR", "RESERVED_NAME", "DUPLICATE_NAME", "TOO_LONG"] as const) {
      const result = mapSubagentValidationError({ code, message: `${code} msg` })
      expect(result.field).toBe("name")
      expect(result.message).toBe(`${code} msg`)
    }
  })

  test("NOT_FOUND falls through to general", () => {
    const result = mapSubagentValidationError({ code: "NOT_FOUND", message: "missing" })
    expect(result.field).toBe("general")
    expect(result.message).toBe("missing")
  })
})

describe("sanitizeSubagentNameInput", () => {
  test("lowercases input", () => {
    expect(sanitizeSubagentNameInput("Reviewer")).toBe("reviewer")
  })

  test("replaces invalid characters with hyphens, collapses repeats", () => {
    expect(sanitizeSubagentNameInput("code review!!")).toBe("code-review-")
  })

  test("trims to max 64 characters", () => {
    const long = "a".repeat(80)
    expect(sanitizeSubagentNameInput(long).length).toBe(64)
  })

  test("allows digits, hyphens, underscores", () => {
    expect(sanitizeSubagentNameInput("ag_3-test")).toBe("ag_3-test")
  })
})

async function mountSubagentsSection(props: {
  subagents: Subagent[]
  providerDefaults?: ChatProviderPreferences
  editing?: { kind: "list" } | { kind: "create" } | { kind: "edit"; id: string }
  handlers?: SubagentsSectionHandlers
}): Promise<{ container: HTMLDivElement; cleanup: () => void }> {
  const container = document.createElement("div")
  document.body.appendChild(container)
  await act(async () => {
    createRoot(container).render(
      <SubagentsSection
        subagents={props.subagents}
        providerDefaults={props.providerDefaults ?? defaultProviderPrefs}
        editing={props.editing ?? { kind: "list" }}
        onSelect={() => undefined}
        onStartCreate={() => undefined}
        onCancelEditing={() => undefined}
        handlers={props.handlers ?? noopHandlers()}
      />,
    )
  })
  return { container, cleanup: () => container.remove() }
}

describe("SubagentsSection — empty state", () => {
  test("renders empty CTA when no subagents", async () => {
    const { container, cleanup } = await mountSubagentsSection({ subagents: [] })
    expect(container.textContent).toContain("No subagents yet")
    expect(container.textContent).toContain("Create subagent")
    cleanup()
  })

  test("clicking Create subagent calls onStartCreate", async () => {
    const onStartCreate = mock(() => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <SubagentsSection
          subagents={[]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "list" }}
          onSelect={() => undefined}
          onStartCreate={onStartCreate}
          onCancelEditing={() => undefined}
          handlers={noopHandlers()}
        />,
      )
    })
    const btn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Create subagent",
    )
    expect(btn).toBeDefined()
    await act(async () => { btn!.click() })
    expect(onStartCreate).toHaveBeenCalledTimes(1)
    container.remove()
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
    const onCancelEditing = mock(() => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <SubagentsSection
          subagents={[]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "create" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={onCancelEditing}
          handlers={noopHandlers()}
        />,
      )
    })
    const cancel = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Cancel",
    )
    expect(cancel).toBeDefined()
    await act(async () => { cancel!.click() })
    expect(onCancelEditing).toHaveBeenCalledTimes(1)
    container.remove()
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
      onCreate: mock(async () => ({ ok: false as const, error: { code: "DUPLICATE_NAME" as const, message: "Name already used" } })),
      onUpdate: mock(async () => ({ ok: false as const, error: { code: "DUPLICATE_NAME" as const, message: "Name already used" } })),
      onDelete: mock(async () => undefined),
    }
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <SubagentsSection
          subagents={[subagent]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "edit", id: "sa-9" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={handlers}
        />,
      )
    })
    // Make the form dirty: tweak description
    const desc = container.querySelector<HTMLInputElement>("[data-testid='subagent-form-description'] ")!
    expect(desc).toBeDefined()
    // Toggle context scope to dirty (works without value-setter hack since it's a real click)
    const fullTranscriptBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Full transcript",
    )!
    await act(async () => { fullTranscriptBtn.click() })
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    expect(save.disabled).toBe(false)
    await act(async () => { save.click() })
    expect(container.textContent).toContain("Name already used")
    expect(handlers.onUpdate).toHaveBeenCalledTimes(1)
    container.remove()
  })
})

describe("SubagentsSection — trigger mode control", () => {
  test("switching to Manual makes form dirty and Save enabled", async () => {
    const subagent = makeSubagent({ id: "sa-9", triggerMode: "auto" })
    const { container, cleanup } = await mountSubagentsSection({
      subagents: [subagent],
      editing: { kind: "edit", id: "sa-9" },
    })
    // Save should be disabled initially (no unsaved changes)
    const save = container.querySelector<HTMLButtonElement>("[data-testid='subagent-form-save']")!
    expect(save.disabled).toBe(true)
    // Find the "Manual" button in the Trigger SegmentedControl
    const manualBtn = Array.from(container.querySelectorAll("button")).find(
      (b) => b.textContent?.trim() === "Manual",
    )
    expect(manualBtn).toBeDefined()
    await act(async () => { manualBtn!.click() })
    // After clicking Manual, form should be dirty so Save is enabled
    expect(save.disabled).toBe(false)
    cleanup()
  })
})

describe("SubagentsSection — delete confirm", () => {
  test("first click flips Delete to 'Confirm delete', second click calls onDelete", async () => {
    const onDelete = mock(async (_id: string) => undefined)
    const handlers: SubagentsSectionHandlers = {
      ...noopHandlers(),
      onDelete,
    }
    const subagent = makeSubagent({ id: "sa-1" })
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <SubagentsSection
          subagents={[subagent]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "edit", id: "sa-1" }}
          onSelect={() => undefined}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={handlers}
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
    container.remove()
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
    const onSelect = mock((_id: string) => undefined)
    const container = document.createElement("div")
    document.body.appendChild(container)
    await act(async () => {
      createRoot(container).render(
        <SubagentsSection
          subagents={[makeSubagent({ id: "sa-1", name: "reviewer" })]}
          providerDefaults={defaultProviderPrefs}
          editing={{ kind: "list" }}
          onSelect={onSelect}
          onStartCreate={() => undefined}
          onCancelEditing={() => undefined}
          handlers={noopHandlers()}
        />,
      )
    })
    const row = Array.from(container.querySelectorAll("button")).find((b) =>
      b.getAttribute("data-testid") === "subagent-row:sa-1",
    )
    expect(row).toBeDefined()
    await act(async () => { row!.click() })
    expect(onSelect).toHaveBeenCalledWith("sa-1")
    container.remove()
  })
})
