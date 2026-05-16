import { afterEach, describe, expect, test } from "bun:test"
import {
  migrateChatPreferencesState,
  NEW_CHAT_COMPOSER_ID,
  useChatPreferencesStore,
} from "./chatPreferencesStore"

const INITIAL_STATE = useChatPreferencesStore.getInitialState()

afterEach(() => {
  useChatPreferencesStore.setState(INITIAL_STATE)
})

describe("migrateChatPreferencesState", () => {
  test("preserves max effort for versioned Opus Claude models", () => {
    const migrated = migrateChatPreferencesState({
      defaultProvider: "last_used",
      providerDefaults: {
        claude: {
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
          planMode: false,
        },
      },
    })

    expect(migrated.providerDefaults.claude).toEqual({
      model: "claude-opus-4-7",
      modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
      planMode: false,
    })
  })

  test("normalizes provider defaults and legacy composer state", () => {
    const migrated = migrateChatPreferencesState({
      defaultProvider: "last_used",
      providerDefaults: {
        claude: {
          model: "opus",
          modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
          planMode: true,
        },
        codex: {
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "minimal", fastMode: true },
          planMode: false,
        },
      },
      composerState: {
        provider: "claude",
        model: "sonnet",
        modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
        planMode: false,
      },
    })

    expect(migrated).toEqual({
      defaultProvider: "last_used",
      providerDefaults: {
        claude: {
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
          planMode: true,
        },
        codex: {
          model: "gpt-5.5",
          modelOptions: { reasoningEffort: "minimal", fastMode: true },
          planMode: false,
        },
      },
      chatStates: {},
      legacyComposerState: {
        provider: "claude",
        model: "claude-sonnet-4-6",
        modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
        planMode: false,
      },
    })
  })

  test("drops unsupported Claude context window selections during migration", () => {
    const migrated = migrateChatPreferencesState({
      defaultProvider: "last_used",
      providerDefaults: {
        claude: {
          model: "haiku",
          modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
          planMode: false,
        },
      },
      chatStates: {
        chatA: {
          provider: "claude",
          model: "haiku",
          modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
          planMode: false,
        },
      },
    })

    expect(migrated.providerDefaults.claude.modelOptions).toEqual({ reasoningEffort: "low", contextWindow: "200k" })
    expect(migrated.chatStates.chatA).toEqual({
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      planMode: false,
    })
  })

  test("rewrites persisted Codex defaults to gpt-5.5 during migration", () => {
    const migrated = migrateChatPreferencesState({
      defaultProvider: "last_used",
      providerDefaults: {
        codex: {
          model: "gpt-5-codex",
          modelOptions: { reasoningEffort: "low", fastMode: true },
          planMode: false,
        },
      },
    })

    expect(migrated.providerDefaults.codex).toEqual({
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "low", fastMode: true },
      planMode: false,
    })
  })

  test("rewrites persisted Codex composer state to gpt-5.5 during migration", () => {
    const migrated = migrateChatPreferencesState({
      defaultProvider: "codex",
      providerDefaults: {
        codex: {
          model: "gpt-5.3-codex-spark",
          modelOptions: { reasoningEffort: "low", fastMode: true },
          planMode: true,
        },
      },
      chatStates: {
        chatA: {
          provider: "codex",
          model: "gpt-5.4",
          modelOptions: { reasoningEffort: "medium", fastMode: false },
          planMode: false,
        },
      },
      legacyComposerState: {
        provider: "codex",
        model: "gpt-5.3-codex",
        modelOptions: { reasoningEffort: "xhigh", fastMode: true },
        planMode: true,
      },
    })

    expect(migrated.providerDefaults.codex).toEqual({
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "low", fastMode: true },
      planMode: true,
    })
    expect(migrated.chatStates.chatA).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "medium", fastMode: false },
      planMode: false,
    })
    expect(migrated.legacyComposerState).toEqual({
      provider: "codex",
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "xhigh", fastMode: true },
      planMode: true,
    })
  })
})

describe("chat preference store", () => {
  test("starts with gpt-5.5 as the default Codex model", () => {
    expect(INITIAL_STATE.providerDefaults.codex).toEqual({
      model: "gpt-5.5",
      modelOptions: { reasoningEffort: "high", fastMode: false },
      planMode: false,
    })
  })

  test("editing provider defaults does not change existing chat state", () => {
    useChatPreferencesStore.getState().setComposerState("chat-a", {
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })

    useChatPreferencesStore.getState().setProviderDefaultModel("codex", "gpt-5.3-codex-spark")
    useChatPreferencesStore.getState().setProviderDefaultModelOptions("codex", {
      reasoningEffort: "low",
      fastMode: false,
    })
    useChatPreferencesStore.getState().setProviderDefaultPlanMode("codex", false)

    expect(useChatPreferencesStore.getState().getComposerState("chat-a")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
  })

  test("restores isolated composer state by chat id", () => {
    const store = useChatPreferencesStore.getState()

    store.setComposerState("chat-a", {
      provider: "claude",
      model: "claude-sonnet-4-6",
      modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
      planMode: false,
    })
    store.setComposerState("chat-b", {
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
    store.setChatComposerPlanMode("chat-a", true)

    expect(store.getComposerState("chat-a")).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-6",
      modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
      planMode: true,
    })
    expect(store.getComposerState("chat-b")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
  })

  test("switching Claude chat model clears unsupported context window values", () => {
    const store = useChatPreferencesStore.getState()

    store.setComposerState("chat-a", {
      provider: "claude",
      model: "claude-opus-4-7",
      modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
      planMode: false,
    })
    store.setChatComposerModel("chat-a", "haiku")

    expect(store.getComposerState("chat-a")).toEqual({
      provider: "claude",
      model: "claude-haiku-4-5-20251001",
      modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
      planMode: false,
    })
  })

  test("resetChatComposerFromProvider copies provider defaults into the target chat", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        codex: {
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "minimal", fastMode: true },
          planMode: true,
        },
      },
    })

    useChatPreferencesStore.getState().resetChatComposerFromProvider("chat-a", "codex")

    expect(useChatPreferencesStore.getState().getComposerState("chat-a")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
  })

  test("initializeComposerForChat uses explicit provider defaults for new chats", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "codex",
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        codex: {
          model: "gpt-5.3-codex-spark",
          modelOptions: { reasoningEffort: "minimal", fastMode: true },
          planMode: true,
        },
      },
    })

    useChatPreferencesStore.getState().initializeComposerForChat("chat-a")

    expect(useChatPreferencesStore.getState().getComposerState("chat-a")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex-spark",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
  })

  test("initializeComposerForChat respects providerHint over defaults and source state", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "last_used",
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        codex: {
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "low", fastMode: false },
          planMode: false,
        },
      },
      chatStates: {
        [NEW_CHAT_COMPOSER_ID]: {
          provider: "claude",
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
          planMode: false,
        },
      },
    })

    const sourceState = useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)
    useChatPreferencesStore.getState().initializeComposerForChat("chat-restored", {
      sourceState,
      providerHint: "codex",
    })

    expect(useChatPreferencesStore.getState().getComposerState("chat-restored")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "low", fastMode: false },
      planMode: false,
    })
  })

  test("initializeComposerForChat ignores providerHint when chat already initialized", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      chatStates: {
        "chat-existing": {
          provider: "claude",
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "max", contextWindow: "1m" },
          planMode: false,
        },
      },
    })

    useChatPreferencesStore.getState().initializeComposerForChat("chat-existing", {
      providerHint: "codex",
    })

    expect(useChatPreferencesStore.getState().getComposerState("chat-existing").provider).toBe("claude")
  })

  test("applyServerDefaults drops the stale new-chat composer when provider defaults change", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "claude",
      chatStates: {
        "chat-a": {
          provider: "codex",
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "minimal", fastMode: true },
          planMode: true,
        },
        [NEW_CHAT_COMPOSER_ID]: {
          provider: "claude",
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
          planMode: false,
        },
      },
    })

    useChatPreferencesStore.getState().applyServerDefaults("claude", {
      claude: {
        model: "claude-sonnet-4-6",
        modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
        planMode: true,
      },
      codex: { ...INITIAL_STATE.providerDefaults.codex },
    })

    expect(useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)).toEqual({
      provider: "claude",
      model: "claude-sonnet-4-6",
      modelOptions: { reasoningEffort: "low", contextWindow: "1m" },
      planMode: true,
    })
    expect(useChatPreferencesStore.getState().getComposerState("chat-a")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "minimal", fastMode: true },
      planMode: true,
    })
  })

  test("applyServerDefaults drops the stale new-chat composer when default provider changes", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "claude",
      chatStates: {
        [NEW_CHAT_COMPOSER_ID]: {
          provider: "claude",
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "high", contextWindow: "200k" },
          planMode: false,
        },
      },
    })

    useChatPreferencesStore.getState().applyServerDefaults("codex", {
      ...INITIAL_STATE.providerDefaults,
    })

    expect(useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)).toEqual({
      provider: "codex",
      model: INITIAL_STATE.providerDefaults.codex.model,
      modelOptions: { ...INITIAL_STATE.providerDefaults.codex.modelOptions },
      planMode: INITIAL_STATE.providerDefaults.codex.planMode,
    })
  })

  test("applyServerDefaults preserves the new-chat composer when defaults are unchanged", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "last_used",
      chatStates: {
        [NEW_CHAT_COMPOSER_ID]: {
          provider: "codex",
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "low", fastMode: false },
          planMode: true,
        },
      },
    })

    useChatPreferencesStore.getState().applyServerDefaults("last_used", {
      ...INITIAL_STATE.providerDefaults,
    })

    expect(useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "low", fastMode: false },
      planMode: true,
    })
  })

  test("new chat composer prefers server provider defaults over hardcoded legacy state when last_used", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "last_used",
      chatStates: {},
      providerDefaults: {
        ...INITIAL_STATE.providerDefaults,
        claude: {
          model: "claude-opus-4-7",
          modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
          planMode: false,
        },
      },
    })

    expect(useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)).toEqual({
      provider: "claude",
      model: "claude-opus-4-7",
      modelOptions: { reasoningEffort: "high", contextWindow: "1m" },
      planMode: false,
    })
  })

  test("initializeComposerForChat with last_used copies the provided source state", () => {
    useChatPreferencesStore.setState({
      ...INITIAL_STATE,
      defaultProvider: "last_used",
      chatStates: {
        [NEW_CHAT_COMPOSER_ID]: {
          provider: "codex",
          model: "gpt-5.3-codex",
          modelOptions: { reasoningEffort: "low", fastMode: false },
          planMode: true,
        },
      },
    })

    const sourceState = useChatPreferencesStore.getState().getComposerState(NEW_CHAT_COMPOSER_ID)
    useChatPreferencesStore.getState().initializeComposerForChat("chat-a", { sourceState })

    expect(useChatPreferencesStore.getState().getComposerState("chat-a")).toEqual({
      provider: "codex",
      model: "gpt-5.3-codex",
      modelOptions: { reasoningEffort: "low", fastMode: false },
      planMode: true,
    })
  })
})
