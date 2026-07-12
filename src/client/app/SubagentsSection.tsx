import * as React from "react"
import { useCallback, useEffect, useMemo } from "react"
import { Bot, Plus } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { SegmentedControl } from "../components/ui/segmented-control"
import { Textarea } from "../components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { cn } from "../lib/utils"
import {
  CLAUDE_CONTEXT_WINDOW_OPTIONS,
  CLAUDE_REASONING_OPTIONS,
  CODEX_REASONING_OPTIONS,
  DEFAULT_CLAUDE_MODEL_OPTIONS,
  DEFAULT_CODEX_MODEL_OPTIONS,
  DEFAULT_OPENROUTER_SDK_MODEL,
  getProviderCatalog,
  isClaudeContextWindow,
  isClaudeReasoningEffort,
  isCodexReasoningEffort,
  isAgentProvider,
  isSubagentContextScope,
  isSubagentTriggerMode,
  mergeCustomModels,
  PROVIDERS,
  type AgentProvider,
  type ChatProviderPreferences,
  type ClaudeContextWindow,
  type ClaudeModelOptions,
  type ClaudeReasoningEffort,
  type CodexModelOptions,
  type CodexReasoningEffort,
  type ProviderCatalogEntry,
  type Subagent,
  type SubagentInput,
  type SubagentValidationError,
  type SubagentValidationErrorCode,
} from "../../shared/types"
import { isRecord } from "../../shared/errors"
import type { SubagentCommandResult } from "../../shared/protocol"
import { useSubagentsSectionStore } from "../stores/subagentsSectionStore"

function isClaudeModelOptions(opts: ClaudeModelOptions | CodexModelOptions): opts is ClaudeModelOptions {
  return "contextWindow" in opts
}
function isCodexModelOptions(opts: ClaudeModelOptions | CodexModelOptions): opts is CodexModelOptions {
  return "fastMode" in opts
}

export interface SubagentsSectionHandlers {
  onCreate: (input: SubagentInput) => Promise<SubagentCommandResult>
  onUpdate: (id: string, patch: SubagentInput) => Promise<SubagentCommandResult>
  onDelete: (id: string) => Promise<void>
}

export type SubagentsEditingState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }

interface SubagentsSectionProps {
  subagents: Subagent[]
  providerDefaults: ChatProviderPreferences
  availableProviders: ProviderCatalogEntry[]
  editing: SubagentsEditingState
  onSelect: (id: string) => void
  onStartCreate: () => void
  onCancelEditing: () => void
  handlers: SubagentsSectionHandlers
}

export function SubagentsSection(props: SubagentsSectionProps) {
  const editing = props.editing
  const selected = useMemo(() => {
    if (editing.kind !== "edit") return null
    return props.subagents.find((s) => s.id === editing.id) ?? null
  }, [editing, props.subagents])

  const formMode = editing.kind
  const isFormOpen = formMode !== "list"
  const isEmpty = props.subagents.length === 0

  if (isEmpty && !isFormOpen) {
    return <SubagentEmptyState onStartCreate={props.onStartCreate} />
  }

  return (
    <div className="flex flex-col gap-6 md:flex-row md:items-start md:gap-8">
      {isEmpty ? null : (
        <SubagentList
          subagents={props.subagents}
          editing={props.editing}
          onSelect={props.onSelect}
          onStartCreate={props.onStartCreate}
        />
      )}
      {isFormOpen ? (
        <SubagentForm
          key={formMode === "edit" ? selected?.id ?? "edit" : "create"}
          mode={formMode}
          subject={formMode === "edit" ? selected : null}
          providerDefaults={props.providerDefaults}
          availableProviders={props.availableProviders}
          handlers={props.handlers}
          onCancelEditing={props.onCancelEditing}
        />
      ) : (
        <SubagentDetailPlaceholder />
      )}
    </div>
  )
}

function SubagentEmptyState(props: { onStartCreate: () => void }) {
  return (
    <div
      className="flex w-full flex-col items-center gap-4 rounded-lg border border-dashed border-border px-6 py-14 text-center"
      data-testid="subagent-empty"
    >
      <div className="flex size-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Bot className="size-5" aria-hidden />
      </div>
      <p className="text-sm font-medium text-foreground">No subagents yet</p>
      <Button variant="default" size="sm" onClick={props.onStartCreate}>
        <Plus className="mr-1.5 size-4" /> Create subagent
      </Button>
    </div>
  )
}

function SubagentDetailPlaceholder() {
  return (
    <div className="hidden flex-1 items-center justify-center rounded-lg border border-dashed border-border px-6 py-12 text-center text-sm text-muted-foreground md:flex">
      Select a subagent to edit, or create a new one.
    </div>
  )
}

function SubagentList(props: {
  subagents: Subagent[]
  editing: SubagentsEditingState
  onSelect: (id: string) => void
  onStartCreate: () => void
}) {
  const selectedId = props.editing.kind === "edit" ? props.editing.id : null
  return (
    <aside className="flex w-full flex-col gap-2 md:w-64 md:flex-shrink-0">
      <div className="flex items-center justify-between gap-2">
        <span
          className="text-xs font-medium uppercase tracking-wide text-muted-foreground"
          style={{ fontVariantNumeric: "tabular-nums" }}
        >
          {props.subagents.length} {props.subagents.length === 1 ? "agent" : "agents"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={props.onStartCreate}
          data-testid="subagent-create"
        >
          <Plus className="size-4" />
          <span className="sr-only">Create subagent</span>
        </Button>
      </div>
      <ul className="flex flex-col gap-0.5">
        {props.subagents.map((subagent) => {
          const secondary =
            subagent.description?.trim() ||
            (subagent.contextScope === "previous-assistant-reply"
              ? "Last reply"
              : "Full transcript")
          return (
            <li key={subagent.id}>
              <button
                type="button"
                data-testid={`subagent-row:${subagent.id}`}
                onClick={() => props.onSelect(subagent.id)}
                className={cn(
                  "flex w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted",
                  selectedId === subagent.id && "bg-muted",
                )}
              >
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium text-foreground">
                    {subagent.name}
                  </span>
                  <ProviderChip provider={subagent.provider} />
                </span>
                <span className="w-full truncate text-xs text-muted-foreground">
                  {secondary}
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </aside>
  )
}

function ProviderChip({ provider }: { provider: AgentProvider }) {
  const label = getProviderCatalog(provider).label
  return (
    <span className="inline-flex items-center gap-1 rounded border border-border bg-card px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
      <Bot className="size-3" /> {label}
    </span>
  )
}

interface SubagentFormProps {
  mode: "create" | "edit"
  subject: Subagent | null
  providerDefaults: ChatProviderPreferences
  availableProviders: ProviderCatalogEntry[]
  handlers: SubagentsSectionHandlers
  onCancelEditing: () => void
}

const PROVIDER_OPTIONS = [
  { value: "claude" as const, label: "Claude" },
  { value: "codex" as const, label: "Codex" },
]

const CONTEXT_SCOPE_OPTIONS = [
  { value: "previous-assistant-reply" as const, label: "Last reply" },
  { value: "full-transcript" as const, label: "Full transcript" },
]

const TRIGGER_MODE_OPTIONS = [
  { value: "auto" as const, label: "Auto" },
  { value: "manual" as const, label: "Manual" },
]

function SubagentForm(props: SubagentFormProps) {
  const baseline = useMemo<SubagentInput>(() => {
    if (props.mode === "edit" && props.subject) return toSubagentInput(props.subject)
    return createDefaultSubagentDraft("claude", props.providerDefaults, props.availableProviders)
  }, [props.mode, props.subject, props.providerDefaults, props.availableProviders])

  const resetForm = useSubagentsSectionStore((state) => state.resetForm)
  const form = useSubagentsSectionStore((state) => state.form)
  const patchFormDraft = useSubagentsSectionStore((state) => state.patchFormDraft)
  const setFormDraft = useSubagentsSectionStore((state) => state.setFormDraft)
  const setFormError = useSubagentsSectionStore((state) => state.setFormError)
  const setFormPending = useSubagentsSectionStore((state) => state.setFormPending)
  const setFormConfirmDelete = useSubagentsSectionStore((state) => state.setFormConfirmDelete)

  // Initialize store with baseline on mount (key prop ensures re-mount on subagent switch)
  useEffect(() => {
    resetForm(baseline)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const { draft, error, pending, confirmDelete } = form

  const nameError = error?.field === "name" ? error.message : null
  const generalError = error?.field === "general" ? error.message : null
  const isDirty = isSubagentDraftDirty(draft, baseline)
  const canSave = draft.name.trim().length > 0 && (props.mode === "create" || isDirty)

  function patchDraft(patch: Partial<SubagentInput>) {
    patchFormDraft(patch)
    if (error?.field === "name" && "name" in patch) {
      setFormError(null)
    }
  }

  function handleProviderChange(provider: AgentProvider) {
    if (provider === draft.provider) return
    const defaults = createDefaultSubagentDraft(provider, props.providerDefaults, props.availableProviders)
    setFormDraft({
      ...draft,
      provider,
      model: defaults.model,
      modelOptions: defaults.modelOptions,
    })
  }

  function handleClaudeReasoning(value: ClaudeReasoningEffort) {
    if (draft.provider !== "claude") return
    const opts = isClaudeModelOptions(draft.modelOptions) ? draft.modelOptions : DEFAULT_CLAUDE_MODEL_OPTIONS
    patchFormDraft({ modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS, ...opts, reasoningEffort: value } })
  }

  function handleClaudeContextWindow(value: ClaudeContextWindow) {
    if (draft.provider !== "claude") return
    const opts = isClaudeModelOptions(draft.modelOptions) ? draft.modelOptions : DEFAULT_CLAUDE_MODEL_OPTIONS
    patchFormDraft({ modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS, ...opts, contextWindow: value } })
  }

  function handleCodexReasoning(value: CodexReasoningEffort) {
    if (draft.provider !== "codex") return
    const opts = isCodexModelOptions(draft.modelOptions) ? draft.modelOptions : DEFAULT_CODEX_MODEL_OPTIONS
    patchFormDraft({ modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS, ...opts, reasoningEffort: value } })
  }

  async function handleSubmit() {
    if (!canSave || pending) return
    setFormPending(true)
    setFormError(null)
    try {
      const result =
        props.mode === "create"
          ? await props.handlers.onCreate(draft)
          : await props.handlers.onUpdate(props.subject!.id, draft)
      if (!result.ok) {
        setFormError(mapSubagentValidationError(result.error))
      }
    } finally {
      setFormPending(false)
    }
  }

  async function handleDelete() {
    if (props.mode !== "edit" || !props.subject) return
    if (!confirmDelete) {
      setFormConfirmDelete(true)
      return
    }
    setFormPending(true)
    try {
      await props.handlers.onDelete(props.subject.id)
    } finally {
      setFormPending(false)
      setFormConfirmDelete(false)
    }
  }

  const claudeOptions: ClaudeModelOptions | null = draft.provider === "claude"
    ? { ...DEFAULT_CLAUDE_MODEL_OPTIONS, ...(isClaudeModelOptions(draft.modelOptions) ? draft.modelOptions : {}) }
    : null
  const codexOptions: CodexModelOptions | null = draft.provider === "codex"
    ? { ...DEFAULT_CODEX_MODEL_OPTIONS, ...(isCodexModelOptions(draft.modelOptions) ? draft.modelOptions : {}) }
    : null
  const providerCatalog =
    props.availableProviders.find((entry) => entry.id === draft.provider) ?? getProviderCatalog(draft.provider)

  return (
    <section className="flex w-full flex-1 flex-col gap-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-base font-medium text-foreground">
          {props.mode === "create" ? "New subagent" : draft.name || "Subagent"}
        </h3>
        <p className="text-sm text-muted-foreground">
          Mention with <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">@agent/{draft.name || "<name>"}</code> in chat.
        </p>
      </header>

      {generalError ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {generalError}
        </div>
      ) : null}

      <FormRow label="Name" hint={nameError} hintTone={nameError ? "destructive" : "muted"}>
        <Input
          data-testid="subagent-form-name"
          value={draft.name}
          onChange={(event) => patchDraft({ name: sanitizeSubagentNameInput(event.target.value) })}
          maxLength={SUBAGENT_NAME_MAX}
          placeholder="reviewer"
          className="font-mono"
        />
      </FormRow>

      <FormRow label="Description" hint="Optional. Shown next to the name.">
        <Input
          data-testid="subagent-form-description"
          value={draft.description ?? ""}
          onChange={(event) => patchDraft({ description: event.target.value })}
          placeholder="Reviews diffs against the repo style"
        />
      </FormRow>

      <FormRow label="Provider">
        <SegmentedControl
          value={draft.provider}
          onValueChange={(value) => { if (isAgentProvider(value)) handleProviderChange(value) }}
          options={PROVIDER_OPTIONS}
          size="sm"
        />
      </FormRow>

      <FormRow label="Model">
        <Select
          value={draft.model}
          onValueChange={(value) => patchDraft({ model: value })}
        >
          <SelectTrigger data-testid="subagent-form-model" className="w-full md:w-72">
            <SelectValue placeholder="Select a model" />
          </SelectTrigger>
          <SelectContent>
            {providerCatalog.models.map((model) => (
              <SelectItem key={model.id} value={model.id}>{model.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>

      {claudeOptions ? (
        <>
          <FormRow label="Reasoning effort">
            <SegmentedControl
              value={claudeOptions.reasoningEffort}
              onValueChange={(value) => {
                if (isClaudeReasoningEffort(value)) handleClaudeReasoning(value)
              }}
              options={CLAUDE_REASONING_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
              size="sm"
            />
          </FormRow>
          <FormRow label="Context window">
            <SegmentedControl
              value={claudeOptions.contextWindow}
              onValueChange={(value) => {
                if (isClaudeContextWindow(value)) handleClaudeContextWindow(value)
              }}
              options={CLAUDE_CONTEXT_WINDOW_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
              size="sm"
            />
          </FormRow>
        </>
      ) : null}

      {codexOptions ? (
        <FormRow label="Reasoning effort">
          <SegmentedControl
            value={codexOptions.reasoningEffort}
            onValueChange={(value) => {
              if (isCodexReasoningEffort(value)) handleCodexReasoning(value)
            }}
            options={CODEX_REASONING_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
            size="sm"
          />
        </FormRow>
      ) : null}

      <FormRow label="Context scope">
        <SegmentedControl
          value={draft.contextScope}
          onValueChange={(value) => { if (isSubagentContextScope(value)) patchDraft({ contextScope: value }) }}
          options={CONTEXT_SCOPE_OPTIONS}
          size="sm"
        />
      </FormRow>

      <FormRow
        label="Trigger"
        hint="Auto: the main agent may delegate on its own. Manual: only runs when you @-mention it."
      >
        <SegmentedControl
          value={draft.triggerMode ?? "auto"}
          onValueChange={(value) => { if (isSubagentTriggerMode(value)) patchDraft({ triggerMode: value }) }}
          options={TRIGGER_MODE_OPTIONS}
          size="sm"
        />
      </FormRow>

      <FormRow label="System prompt" hint="What this persona should focus on. Plain text.">
        <Textarea
          data-testid="subagent-form-system-prompt"
          value={draft.systemPrompt}
          onChange={(event) => patchDraft({ systemPrompt: event.target.value })}
          placeholder="You are a careful code reviewer..."
          rows={6}
          className="min-h-32"
        />
      </FormRow>

      <FormRow
        label="Max turns"
        hint="Optional. Caps the agentic turns per run (like Claude Code's per-agent maxTurns). Empty = unbounded. Claude SDK runs stop gracefully at the limit; PTY/Codex runs are aborted."
      >
        <Input
          data-testid="subagent-form-max-turns"
          type="number"
          min={1}
          step={1}
          value={draft.maxTurns?.toString() ?? ""}
          onChange={(event) => {
            const parsed = Number.parseInt(event.target.value, 10)
            patchDraft({ maxTurns: Number.isInteger(parsed) && parsed > 0 ? parsed : undefined })
          }}
          placeholder="unbounded"
          className="w-36"
        />
      </FormRow>

      {draft.provider === "claude" ? (
        <>
          <FormRow
            label="Working directory"
            hint="Optional. Relative to the parent chat cwd. Restricts the subagent's filesystem access to this subtree."
          >
            <Input
              data-testid="subagent-form-working-dir"
              value={draft.workingDir ?? ""}
              onChange={(event) => {
                const v = event.target.value
                patchDraft({ workingDir: v.length > 0 ? v : undefined })
              }}
              placeholder="docs"
            />
          </FormRow>

          <FormRow
            label="Allowed paths"
            hint="Optional. Newline-separated, relative to the parent chat cwd. When set, file tools can only read/write inside these roots."
          >
            <Textarea
              data-testid="subagent-form-allowed-paths"
              value={(draft.allowedPaths ?? []).join("\n")}
              onChange={(event) => {
                const lines = event.target.value
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter((l) => l.length > 0)
                patchDraft({ allowedPaths: lines.length > 0 ? lines : undefined })
              }}
              placeholder={"docs\nwiki"}
              rows={3}
            />
          </FormRow>
        </>
      ) : null}

      <footer className="flex flex-wrap items-center justify-end gap-2 pt-2">
        <Button variant="ghost" size="sm" onClick={props.onCancelEditing}>Cancel</Button>
        {props.mode === "edit" ? (
          <Button
            variant="destructive"
            size="sm"
            data-testid="subagent-form-delete"
            disabled={pending}
            onClick={handleDelete}
          >
            {confirmDelete ? "Confirm delete" : "Delete"}
          </Button>
        ) : null}
        <Button
          variant="default"
          size="sm"
          data-testid="subagent-form-save"
          disabled={!canSave || pending}
          onClick={handleSubmit}
        >
          {pending ? "Saving…" : "Save"}
        </Button>
      </footer>
    </section>
  )
}

function FormRow(props: {
  label: string
  hint?: string | null
  hintTone?: "muted" | "destructive"
  children: React.ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <span className="text-xs font-medium text-foreground">{props.label}</span>
      {props.children}
      {props.hint ? (
        <span
          className={cn(
            "text-xs",
            props.hintTone === "destructive" ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {props.hint}
        </span>
      ) : null}
    </div>
  )
}

// ── SettingsPage wiring ──────────────────────────────────────────────────────
import type { KannaState } from "./useKannaState"
import { useAppSettingsStore, selectCustomModels } from "../stores/appSettingsStore"

const EMPTY_SUBAGENTS: Subagent[] = []

const FALLBACK_PROVIDER_PREFS: ChatProviderPreferences = {
  claude: {
    model: getProviderCatalog("claude").defaultModel,
    modelOptions: { ...DEFAULT_CLAUDE_MODEL_OPTIONS },
    planMode: false,
  },
  codex: {
    model: getProviderCatalog("codex").defaultModel,
    modelOptions: { ...DEFAULT_CODEX_MODEL_OPTIONS },
    planMode: false,
  },
  openrouter: {
    model: DEFAULT_OPENROUTER_SDK_MODEL,
    modelOptions: {},
    planMode: false,
  },
}

export function SubagentsSettingsBranch(props: {
  state: Pick<KannaState, "socket" | "appSettings" | "handleWriteAppSettings">
}) {
  const subagents = useAppSettingsStore(
    (store) => store.settings?.subagents ?? EMPTY_SUBAGENTS,
  )
  const providerDefaults = useAppSettingsStore(
    (store) => store.settings?.providerDefaults ?? FALLBACK_PROVIDER_PREFS,
  )
  const customModels = useAppSettingsStore(selectCustomModels)
  const availableProviders = useMemo(
    () => mergeCustomModels([...PROVIDERS], customModels),
    [customModels],
  )

  const editing = useSubagentsSectionStore((state) => state.editing)
  const setEditing = useSubagentsSectionStore((state) => state.setEditing)

  const handlers = useMemo<SubagentsSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        const result = await props.state.socket.command<SubagentCommandResult>({
          type: "subagent.create",
          input,
        })
        if (result.ok) setEditing({ kind: "edit", id: result.subagent.id })
        return result
      },
      onUpdate: async (id, input) => {
        const result = await props.state.socket.command<SubagentCommandResult>({
          type: "subagent.update",
          id,
          // maxTurns: explicit null when cleared — an absent key would keep
          // the server's previous value (JSON drops undefined).
          patch: { ...input, maxTurns: input.maxTurns ?? null },
        })
        return result
      },
      onDelete: async (id) => {
        await props.state.socket.command({ type: "subagent.delete", id })
        setEditing({ kind: "list" })
      },
    }),
    [props.state.socket, setEditing],
  )

  const handleSelect = useCallback((id: string) => {
    setEditing({ kind: "edit", id })
  }, [setEditing])

  const handleStartCreate = useCallback(() => {
    setEditing({ kind: "create" })
  }, [setEditing])

  const handleCancelEditing = useCallback(() => {
    setEditing({ kind: "list" })
  }, [setEditing])

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <LoopRuntimePanel
        subagents={subagents}
        handleWriteAppSettings={props.state.handleWriteAppSettings}
      />
      <SubagentsSection
        subagents={subagents}
        providerDefaults={providerDefaults}
        availableProviders={availableProviders}
        editing={editing}
        onSelect={handleSelect}
        onStartCreate={handleStartCreate}
        onCancelEditing={handleCancelEditing}
        handlers={handlers}
      />
    </div>
  )
}

const DEFAULT_LOOP_SUBAGENT_NONE = "__none__"
const SUBAGENT_RUN_TIMEOUT_MIN_S = 30
const SUBAGENT_RUN_TIMEOUT_MAX_S = 86_400
const DEFAULT_SUBAGENT_RUN_TIMEOUT_S = 600

/**
 * Runtime knobs for delegated subagent runs + the autonomous loop:
 * the idle stall-watchdog window and the default loop subagent. Reads
 * `subagentRuntime` off the app-settings store and writes patches through
 * `handleWriteAppSettings` (optimistic, same path as every other setting).
 */
function LoopRuntimePanel(props: {
  subagents: Subagent[]
  handleWriteAppSettings: KannaState["handleWriteAppSettings"]
}) {
  const runtime = useAppSettingsStore((store) => store.settings?.subagentRuntime)
  const timeoutSeconds = runtime ? Math.round(runtime.runTimeoutMs / 1000) : DEFAULT_SUBAGENT_RUN_TIMEOUT_S
  const defaultLoopSubagentId = runtime?.defaultLoopSubagentId ?? null

  const timeoutDraft = useSubagentsSectionStore((state) => state.timeoutDraft)
  const setTimeoutDraft = useSubagentsSectionStore((state) => state.setTimeoutDraft)
  const error = useSubagentsSectionStore((state) => state.loopError)
  const setError = useSubagentsSectionStore((state) => state.setLoopError)

  // Sync draft when server value changes (e.g. on load)
  useEffect(() => {
    setTimeoutDraft(String(timeoutSeconds))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeoutSeconds])

  function commitTimeout() {
    const seconds = Number(timeoutDraft)
    if (!Number.isInteger(seconds) || seconds < SUBAGENT_RUN_TIMEOUT_MIN_S || seconds > SUBAGENT_RUN_TIMEOUT_MAX_S) {
      setTimeoutDraft(String(timeoutSeconds))
      setError(`Timeout must be a whole number of seconds between ${SUBAGENT_RUN_TIMEOUT_MIN_S} and ${SUBAGENT_RUN_TIMEOUT_MAX_S}.`)
      return
    }
    setError(null)
    if (seconds === timeoutSeconds) return
    void props.handleWriteAppSettings({ subagentRuntime: { runTimeoutMs: seconds * 1000 } })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to save subagent runtime settings."))
  }

  function handleDefaultChange(value: string) {
    setError(null)
    const next = value === DEFAULT_LOOP_SUBAGENT_NONE ? null : value
    void props.handleWriteAppSettings({ subagentRuntime: { defaultLoopSubagentId: next } })
      .catch((err) => setError(err instanceof Error ? err.message : "Unable to save default loop subagent."))
  }

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border/60 bg-card/40 p-4">
      <header className="flex flex-col gap-1">
        <h3 className="text-sm font-medium text-foreground">Loop &amp; runtime</h3>
        <p className="text-xs text-muted-foreground">
          Applies to background subagent runs and the autonomous <code className="rounded bg-muted px-1 py-0.5 font-mono">/loop</code>.
        </p>
      </header>

      {error ? (
        <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {error}
        </div>
      ) : null}

      <FormRow
        label="Stall timeout (seconds)"
        hint="A subagent run is aborted only after this long with no streamed activity — not a total wall-clock cap. A steadily-working run is never killed."
      >
        <Input
          type="number"
          inputMode="numeric"
          min={SUBAGENT_RUN_TIMEOUT_MIN_S}
          max={SUBAGENT_RUN_TIMEOUT_MAX_S}
          value={timeoutDraft}
          onChange={(event) => setTimeoutDraft(event.target.value)}
          onBlur={commitTimeout}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return
            commitTimeout()
            event.currentTarget.blur()
          }}
          className="w-full md:w-48 tabular-nums"
        />
      </FormRow>

      <FormRow
        label="Default loop subagent"
        hint="The subagent setup_loop delegates each chunk to when no explicit id is given."
      >
        <Select value={defaultLoopSubagentId ?? DEFAULT_LOOP_SUBAGENT_NONE} onValueChange={handleDefaultChange}>
          <SelectTrigger className="w-full md:w-72">
            <SelectValue placeholder="None" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={DEFAULT_LOOP_SUBAGENT_NONE}>None (require explicit id)</SelectItem>
            {props.subagents.map((subagent) => (
              <SelectItem key={subagent.id} value={subagent.id}>{subagent.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </FormRow>
    </section>
  )
}

export const SUBAGENT_NAME_MAX = 64

const NAME_FIELD_CODES = new Set<SubagentValidationErrorCode>([
  "EMPTY_NAME",
  "INVALID_CHAR",
  "RESERVED_NAME",
  "DUPLICATE_NAME",
  "TOO_LONG",
])

export type SubagentFieldKey = "name" | "general"

export interface SubagentFieldError {
  field: SubagentFieldKey
  message: string
}

export function createDefaultSubagentDraft(
  provider: AgentProvider,
  providerDefaults: ChatProviderPreferences | undefined,
  availableProviders?: ProviderCatalogEntry[],
): SubagentInput {
  if (provider === "claude") {
    const preference = providerDefaults?.claude
    const model =
      preference?.model
      ?? availableProviders?.find((entry) => entry.id === "claude")?.defaultModel
      ?? getProviderCatalog("claude").defaultModel
    const modelOptions: ClaudeModelOptions =
      preference?.modelOptions ?? { ...DEFAULT_CLAUDE_MODEL_OPTIONS }
    return {
      name: "",
      provider,
      model,
      modelOptions: { ...modelOptions },
      systemPrompt: "",
      contextScope: "previous-assistant-reply",
      triggerMode: "auto",
    }
  }
  const preference = providerDefaults?.codex
  const model =
    preference?.model
    ?? availableProviders?.find((entry) => entry.id === "codex")?.defaultModel
    ?? getProviderCatalog("codex").defaultModel
  const modelOptions: CodexModelOptions =
    preference?.modelOptions ?? { ...DEFAULT_CODEX_MODEL_OPTIONS }
  return {
    name: "",
    provider,
    model,
    modelOptions: { ...modelOptions },
    systemPrompt: "",
    contextScope: "previous-assistant-reply",
    triggerMode: "auto",
  }
}

export function toSubagentInput(subagent: Subagent): SubagentInput {
  return {
    name: subagent.name,
    description: subagent.description,
    provider: subagent.provider,
    model: subagent.model,
    modelOptions: subagent.modelOptions,
    systemPrompt: subagent.systemPrompt,
    contextScope: subagent.contextScope,
    triggerMode: subagent.triggerMode,
    workingDir: subagent.workingDir,
    allowedPaths: subagent.allowedPaths,
    maxTurns: subagent.maxTurns,
  }
}

const stringArrayEqual = (a: string[] | undefined, b: string[] | undefined): boolean => {
  if (a === b) return true
  if (!a || !b) return false
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false
  return true
}

export function isSubagentDraftDirty(draft: SubagentInput, baseline: SubagentInput): boolean {
  if (draft.name !== baseline.name) return true
  if ((draft.description ?? "") !== (baseline.description ?? "")) return true
  if (draft.provider !== baseline.provider) return true
  if (draft.model !== baseline.model) return true
  if (draft.systemPrompt !== baseline.systemPrompt) return true
  if (draft.contextScope !== baseline.contextScope) return true
  if ((draft.triggerMode ?? "auto") !== (baseline.triggerMode ?? "auto")) return true
  if ((draft.workingDir ?? "") !== (baseline.workingDir ?? "")) return true
  if (!stringArrayEqual(draft.allowedPaths, baseline.allowedPaths)) return true
  if ((draft.maxTurns ?? null) !== (baseline.maxTurns ?? null)) return true
  return !shallowEqualModelOptions(draft.modelOptions, baseline.modelOptions)
}

function shallowEqualModelOptions(
  a: ClaudeModelOptions | CodexModelOptions,
  b: ClaudeModelOptions | CodexModelOptions,
): boolean {
  if (!isRecord(a) || !isRecord(b)) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (a[key] !== b[key]) return false
  }
  return true
}

export function mapSubagentValidationError(error: SubagentValidationError): SubagentFieldError {
  if (NAME_FIELD_CODES.has(error.code)) {
    return { field: "name", message: error.message }
  }
  return { field: "general", message: error.message }
}

export function sanitizeSubagentNameInput(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .slice(0, SUBAGENT_NAME_MAX)
}
