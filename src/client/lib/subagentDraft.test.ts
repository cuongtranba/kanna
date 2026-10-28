import { describe, expect, test } from "vite-plus/test"
import {
  createDefaultSubagentDraft,
  isSubagentDraftDirty,
  mapSubagentValidationError,
  sanitizeSubagentNameInput,
  toSubagentInput,
  toSubagentPatch,
} from "./subagentDraft"
import {
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  type ChatProviderPreferences,
  type Subagent,
  type SubagentInput,
} from "../../shared/types"

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
  custom: {
    model: "",
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

  test("returns true when the beacon tools grant is toggled", () => {
    expect(isSubagentDraftDirty({ ...baseline, allowBeaconTools: true }, baseline)).toBe(true)
    expect(isSubagentDraftDirty({ ...baseline, allowBeaconTools: false }, baseline)).toBe(false)
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

describe("toSubagentPatch", () => {
  test("encodes an absent maxTurns as an explicit clear", () => {
    const draft = createDefaultSubagentDraft("claude", undefined)
    expect(toSubagentPatch(draft).maxTurns).toBeNull()
    expect(toSubagentPatch({ ...draft, maxTurns: 5 }).maxTurns).toBe(5)
  })
})

describe("createDefaultSubagentDraft model fallback", () => {
  test("an empty preferred model falls back to the catalog default for every provider", () => {
    const prefs: ChatProviderPreferences = {
      claude: { model: "", modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS }, planMode: false },
      codex: { model: "", modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS }, planMode: false },
      openrouter: { model: "", modelOptions: {}, planMode: false },
      custom: { model: "", modelOptions: {}, planMode: false },
    }
    expect(createDefaultSubagentDraft("claude", prefs).model).toBe("claude-sonnet-4-6")
    expect(createDefaultSubagentDraft("codex", prefs).model).toBe("gpt-5.5")
    expect(createDefaultSubagentDraft("openrouter", prefs).model).toBe(DEFAULT_OPENROUTER_SDK_MODEL)
  })
})
