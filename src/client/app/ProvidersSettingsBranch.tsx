import { useEffect } from "react"
import { CLAUDE_IDLE_TIMEOUT_MS_BOUND, CLAUDE_MAX_CONCURRENT_BOUND } from "../../shared/settings/bounds"
import {
  CLAUDE_LIFECYCLE_DEFAULTS,
  isAgentProvider,
  type AgentProvider,
} from "../../shared/types"
import { ChatPreferenceControls } from "../components/chat-ui/ChatPreferenceControls"
import { OAuthTokenPoolCard } from "../components/chat-ui/OAuthTokenPoolCard"
import { SettingsRow } from "../components/settings/SettingsList"
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "../components/ui/select"
import { resolveNumberCommit } from "../lib/numberDraft"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useChatPreferencesStore } from "../stores/chatPreferencesStore"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import { useProvidersSectionStore } from "../stores/providersSectionStore"
import { CustomProvidersSettingsBranch } from "./CustomProvidersSection"
import { QuickResponseRow } from "./QuickResponseRow"
import { SettingsNumberRow } from "./SettingsNumberRow"
import type { KannaState } from "./useKannaState"
import { useAppSettingsWriter } from "./useAppSettingsWriter"
import { useProviderCatalog } from "./useProviderCatalog"

const MIN_IDLE_MINUTES = Math.round(CLAUDE_IDLE_TIMEOUT_MS_BOUND.min / 60_000)
const MAX_IDLE_MINUTES = Math.round(CLAUDE_IDLE_TIMEOUT_MS_BOUND.max / 60_000)
const IDLE_MINUTES_RANGE = { min: MIN_IDLE_MINUTES, max: MAX_IDLE_MINUTES } as const
const DEFAULT_IDLE_MINUTES = Math.round(CLAUDE_LIFECYCLE_DEFAULTS.idleTimeoutMs / 60_000)

function ClaudeLifecycleRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const lifecycle = useAppSettingsStore((s) => s.settings?.claudeDriver.lifecycle)
  const setAppSettingsError = useGeneralSettingsStore((s) => s.setAppSettingsError)
  const idleMinutes = Math.round((lifecycle?.idleTimeoutMs ?? CLAUDE_LIFECYCLE_DEFAULTS.idleTimeoutMs) / 60_000)
  const maxConcurrent = lifecycle?.maxConcurrent ?? CLAUDE_LIFECYCLE_DEFAULTS.maxConcurrent
  const idleDraft = useProvidersSectionStore((s) => s.claudeIdleMinutesDraft)
  const setIdleDraft = useProvidersSectionStore((s) => s.setClaudeIdleMinutesDraft)
  const maxConcurrentDraft = useProvidersSectionStore((s) => s.claudeMaxConcurrentDraft)
  const setMaxConcurrentDraft = useProvidersSectionStore((s) => s.setClaudeMaxConcurrentDraft)

  useEffect(() => {
    setIdleDraft(String(idleMinutes))
  }, [idleMinutes, setIdleDraft])

  useEffect(() => {
    setMaxConcurrentDraft(String(maxConcurrent))
  }, [maxConcurrent, setMaxConcurrentDraft])

  function commitIdleMinutes() {
    const result = resolveNumberCommit(idleDraft, idleMinutes, IDLE_MINUTES_RANGE)
    if (result.kind !== "write") {
      setIdleDraft(String(idleMinutes))
      if (result.kind === "invalid") {
        setAppSettingsError(`Idle timeout must be between ${MIN_IDLE_MINUTES} and ${MAX_IDLE_MINUTES} minutes.`)
      }
      return
    }
    write({ claudeDriver: { lifecycle: { idleTimeoutMs: result.value * 60_000 } } })
  }

  function commitMaxConcurrent() {
    const result = resolveNumberCommit(maxConcurrentDraft, maxConcurrent, CLAUDE_MAX_CONCURRENT_BOUND)
    if (result.kind !== "write") {
      setMaxConcurrentDraft(String(maxConcurrent))
      if (result.kind === "invalid") {
        setAppSettingsError(`Max concurrent sessions must be between ${CLAUDE_MAX_CONCURRENT_BOUND.min} and ${CLAUDE_MAX_CONCURRENT_BOUND.max}.`)
      }
      return
    }
    write({ claudeDriver: { lifecycle: { maxConcurrent: result.value } } })
  }

  return (
    <>
      <SettingsNumberRow
        title="Claude session idle timeout"
        description="Stop a Claude session after this many minutes without user activity. Lower values free memory sooner; higher values keep cold-start latency low."
        min={MIN_IDLE_MINUTES}
        max={MAX_IDLE_MINUTES}
        step={1}
        value={idleDraft}
        onValueChange={setIdleDraft}
        onCommit={commitIdleMinutes}
        hint={`${MIN_IDLE_MINUTES}–${MAX_IDLE_MINUTES} min · default ${DEFAULT_IDLE_MINUTES}`}
      />
      <SettingsNumberRow
        title="Max concurrent Claude sessions"
        description="Hard cap on resident Claude processes. Excess sessions are evicted LRU; their next activation cold-starts."
        min={CLAUDE_MAX_CONCURRENT_BOUND.min}
        max={CLAUDE_MAX_CONCURRENT_BOUND.max}
        step={1}
        value={maxConcurrentDraft}
        onValueChange={setMaxConcurrentDraft}
        onCommit={commitMaxConcurrent}
        hint={`${CLAUDE_MAX_CONCURRENT_BOUND.min}–${CLAUDE_MAX_CONCURRENT_BOUND.max} · default ${CLAUDE_LIFECYCLE_DEFAULTS.maxConcurrent}`}
      />
    </>
  )
}

function ProviderDefaultRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const mergedProviders = useProviderCatalog()
  const defaultProvider = useChatPreferencesStore((store) => store.defaultProvider)
  const providerDefaults = useChatPreferencesStore((store) => store.providerDefaults)
  const setDefaultProvider = useChatPreferencesStore((store) => store.setDefaultProvider)
  const setProviderDefaultModel = useChatPreferencesStore((store) => store.setProviderDefaultModel)
  const setProviderDefaultModelOptions = useChatPreferencesStore((store) => store.setProviderDefaultModelOptions)
  const setProviderDefaultPlanMode = useChatPreferencesStore((store) => store.setProviderDefaultPlanMode)

  function handleDefaultProviderChange(nextValue: "last_used" | AgentProvider) {
    setDefaultProvider(nextValue)
    write({ defaultProvider: nextValue })
  }

  function handleModelChange(provider: AgentProvider, model: string) {
    setProviderDefaultModel(provider, model)
    write({ providerDefaults: { [provider]: { model } } })
  }

  function handleModelOptionsChange(
    provider: AgentProvider,
    modelOptions: Partial<typeof providerDefaults[typeof provider]["modelOptions"]>
  ) {
    setProviderDefaultModelOptions(provider, modelOptions)
    write({ providerDefaults: { [provider]: { modelOptions } } })
  }

  function handlePlanModeChange(provider: AgentProvider, planMode: boolean) {
    setProviderDefaultPlanMode(provider, planMode)
    write({ providerDefaults: { [provider]: { planMode } } })
  }

  return (
    <>
      <SettingsRow
        title="Default Provider"
        description="The default harness used for new chats before a provider is locked by an existing session."
      >
        <Select
          value={defaultProvider}
          onValueChange={(value) => { if (value === "last_used" || isAgentProvider(value)) handleDefaultProviderChange(value) }}
        >
          <SelectTrigger className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectGroup>
              <SelectItem value="last_used">
                Last Used
              </SelectItem>
              {mergedProviders.map((provider) => (
                <SelectItem key={provider.id} value={provider.id}>
                  {provider.label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsRow>

      <CustomProvidersSettingsBranch state={state} />

      <SettingsRow
        title="Claude Code Defaults"
        description="Saved defaults when using Claude Code."
        alignStart
      >
        <div className="max-w-[420px]">
          <ChatPreferenceControls
            availableProviders={mergedProviders}
            selectedProvider="claude"
            showProviderPicker={false}
            model={providerDefaults.claude.model}
            modelOptions={providerDefaults.claude.modelOptions}
            onModelChange={(_, model) => {
              handleModelChange("claude", model)
            }}
            onModelOptionChange={(change) => {
              if (change.type === "claudeReasoningEffort") {
                handleModelOptionsChange("claude", { reasoningEffort: change.effort })
              } else if (change.type === "contextWindow") {
                handleModelOptionsChange("claude", { contextWindow: change.contextWindow })
              }
            }}
            planMode={providerDefaults.claude.planMode}
            onPlanModeChange={(planMode) => handlePlanModeChange("claude", planMode)}
            includePlanMode
            className="justify-start flex-wrap"
          />
        </div>
      </SettingsRow>

      <SettingsRow
        title="Codex Defaults"
        description="Saved defaults when using Codex."
        alignStart
      >
        <div className="max-w-[420px]">
          <ChatPreferenceControls
            availableProviders={mergedProviders}
            selectedProvider="codex"
            showProviderPicker={false}
            model={providerDefaults.codex.model}
            modelOptions={providerDefaults.codex.modelOptions}
            onModelChange={(_, model) => {
              handleModelChange("codex", model)
            }}
            onModelOptionChange={(change) => {
              if (change.type === "codexReasoningEffort") {
                handleModelOptionsChange("codex", { reasoningEffort: change.effort })
              } else if (change.type === "fastMode") {
                handleModelOptionsChange("codex", { fastMode: change.fastMode })
              }
            }}
            planMode={providerDefaults.codex.planMode}
            onPlanModeChange={(planMode) => handlePlanModeChange("codex", planMode)}
            includePlanMode
            className="justify-start flex-wrap"
          />
        </div>
      </SettingsRow>
    </>
  )
}

export function ProvidersSettingsBranch({ state }: { state: KannaState }) {
  const claudeAuth = useAppSettingsStore((s) => s.settings?.claudeAuth)
  return (
    <div className="border-b border-border">
      <SettingsRow
        title="Claude OAuth tokens"
        description="Manage multiple Claude OAuth tokens. Kanna switches automatically when one hits its rate limit."
        bordered={false}
        alignStart
      >
        <div className="w-full md:w-[420px]">
          <OAuthTokenPoolCard
            tokens={claudeAuth?.tokens ?? []}
            concurrencyDefault={claudeAuth?.concurrencyDefault ?? 1}
            onWrite={state.handleWriteClaudeAuth}
            onTest={state.handleTestOAuthToken}
          />
        </div>
      </SettingsRow>

      <ClaudeLifecycleRows state={state} />
      <ProviderDefaultRows state={state} />
      <QuickResponseRow state={state} />
    </div>
  )
}
