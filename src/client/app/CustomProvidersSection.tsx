import { useCallback, useEffect, useMemo } from "react"
import { Plus, Server, X } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover"
import { TruncatedText } from "../components/ui/truncated-text"
import { PopoverMenuItem } from "../components/chat-ui/ChatPreferenceControls"
import {
  SettingsEmptyState,
  SettingsList,
  SettingsRow,
  SettingsRowActions,
} from "../components/settings/SettingsList"
import { selectCustomProviders, useAppSettingsStore } from "../stores/appSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useCustomProvidersSectionStore } from "../stores/customProvidersSectionStore"
import {
  buildCreateInput,
  buildUpdatePatch,
  contextWindowLabel,
  draftFromPreset,
  draftFromProvider,
  emptyCustomProviderDraft,
  keyPlaceholder,
  keyStatusLabel,
  validateDraft,
} from "../lib/customProviderDraft"
import { CUSTOM_PROVIDER_PRESETS, type CustomProviderPreset } from "../../shared/custom-provider-presets"
import {
  CUSTOM_PROVIDER_API_KEY_MAX,
  CUSTOM_PROVIDER_LABEL_MAX,
  CUSTOM_PROVIDER_MODEL_ID_MAX,
  CUSTOM_PROVIDER_MODEL_LABEL_MAX,
  type CustomProviderInput,
  type CustomProviderPatch,
  type CustomProviderPublic,
} from "../../shared/custom-providers"
import { errorMessage } from "../../shared/errors"
import type { KannaState } from "./useKannaState"
import {
  useAppSettingsCrudHandlers,
  type AppSettingsCrudHandlers,
} from "./appSettingsCrud"
import { editorSubmitLabel, submitEditorForm } from "./settingsEditorForm"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export type CustomProvidersHandlers = AppSettingsCrudHandlers<CustomProviderInput, CustomProviderPatch>

const SECTION_DESCRIPTION =
  "Anthropic-compatible endpoints such as GLM, Qwen, Kimi, DeepSeek or MiniMax. They run through the Claude agent, so tools, skills and MCP work as usual. Pick them in the chat composer under Custom endpoints."

function modelCountLabel(count: number): string {
  return `${count} ${count === 1 ? "model" : "models"}`
}

interface CustomProvidersSectionProps {
  providers: readonly CustomProviderPublic[]
  handlers: CustomProvidersHandlers
  dom?: DomPort
}

export function CustomProvidersSection({ providers, handlers, dom = domAdapter }: CustomProvidersSectionProps) {
  const editing = useCustomProvidersSectionStore((state) => state.editing)
  const discardEditor = useCustomProvidersSectionStore((state) => state.discardEditor)

  useEffect(() => {
    discardEditor()
  }, [discardEditor])

  return (
    <div className="border-t border-border pb-5">
      <SettingsRow
        title="Custom endpoints"
        description={SECTION_DESCRIPTION}
        bordered={false}
        alignStart
      >
        {editing.kind === "list" ? <AddEndpointMenu providers={providers} /> : null}
      </SettingsRow>
      {editing.kind === "list" ? (
        <ProviderList providers={providers} onDelete={handlers.onDelete} dom={dom} />
      ) : (
        <ProviderEditor providers={providers} editingId={editing.kind === "edit" ? editing.id : null} handlers={handlers} />
      )}
    </div>
  )
}

function AddEndpointMenu({ providers }: { providers: readonly CustomProviderPublic[] }) {
  const menuOpen = useCustomProvidersSectionStore((state) => state.menuOpen)
  const setMenuOpen = useCustomProvidersSectionStore((state) => state.setMenuOpen)
  const startEditing = useCustomProvidersSectionStore((state) => state.startEditing)
  const takenIds = useMemo(() => providers.map((provider) => provider.id), [providers])

  const handlePickPreset = useCallback((preset: CustomProviderPreset) => {
    startEditing({ kind: "create" }, draftFromPreset(preset, takenIds))
  }, [startEditing, takenIds])

  const handlePickBlank = useCallback(() => {
    startEditing({ kind: "create" }, emptyCustomProviderDraft())
  }, [startEditing])

  return (
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1 h-4 w-4" />
          Add endpoint
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-64 p-1">
        <div className="space-y-1">
          {CUSTOM_PROVIDER_PRESETS.map((preset) => (
            <PopoverMenuItem
              key={preset.id}
              onClick={() => handlePickPreset(preset)}
              selected={false}
              icon={<Server className="h-4 w-4 text-muted-foreground" />}
              label={preset.label}
            />
          ))}
          <PopoverMenuItem
            onClick={handlePickBlank}
            selected={false}
            icon={<Plus className="h-4 w-4 text-muted-foreground" />}
            label="Custom…"
            description="Any Anthropic-compatible URL"
          />
        </div>
      </PopoverContent>
    </Popover>
  )
}

function ProviderList({
  providers,
  onDelete,
  dom,
}: {
  providers: readonly CustomProviderPublic[]
  onDelete: (id: string) => Promise<void>
  dom: DomPort
}) {
  const listError = useCustomProvidersSectionStore((state) => state.listError)
  return (
    <div className="flex flex-col gap-3">
      {listError ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {listError}
        </div>
      ) : null}
      {providers.length === 0 ? (
        <SettingsEmptyState icon={Server} message="No custom endpoints yet." />
      ) : (
        <SettingsList>
          {providers.map((provider) => (
            <ProviderRow key={provider.id} provider={provider} onDelete={onDelete} dom={dom} />
          ))}
        </SettingsList>
      )}
    </div>
  )
}

function ProviderRow({
  provider,
  onDelete,
  dom,
}: {
  provider: CustomProviderPublic
  onDelete: (id: string) => Promise<void>
  dom: DomPort
}) {
  const startEditing = useCustomProvidersSectionStore((state) => state.startEditing)
  const setListError = useCustomProvidersSectionStore((state) => state.setListError)
  const deleteKey = pendingActionKey("settings.customProviders.delete", provider.id)
  const deletePending = usePendingAction(deleteKey)

  const handleEdit = useCallback(() => {
    startEditing({ kind: "edit", id: provider.id }, draftFromProvider(provider))
  }, [provider, startEditing])

  const handleDelete = useCallback(() => {
    if (!dom.confirmDialog(`Delete endpoint "${provider.label}"?`)) return
    runPendingAction(deleteKey, async () => {
      setListError(null)
      try {
        await onDelete(provider.id)
      } catch (cause) {
        setListError(errorMessage(cause))
      }
    })
  }, [deleteKey, dom, onDelete, provider.id, provider.label, setListError])

  return (
    <li className="flex items-center gap-3 px-4 py-3" aria-busy={deletePending || undefined}>
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <span className="truncate font-medium">{provider.label}</span>
        <TruncatedText tooltip={provider.baseUrl} className="font-mono text-xs text-muted-foreground">
          {provider.baseUrl}
        </TruncatedText>
      </div>
      <div className="flex shrink-0 flex-col items-end gap-0.5 text-xs text-muted-foreground">
        <span className="tabular-nums">{modelCountLabel(provider.models.length)}</span>
        {provider.contextWindow !== undefined ? (
          <span className="tabular-nums">{contextWindowLabel(provider.contextWindow)}</span>
        ) : null}
        <span>{keyStatusLabel(provider.apiKeyHint)}</span>
      </div>
      <div className="flex shrink-0 items-center gap-1">
        <SettingsRowActions label={provider.label} onEdit={handleEdit} onDelete={handleDelete} deletePending={deletePending} />
      </div>
    </li>
  )
}

function ProviderEditor({
  providers,
  editingId,
  handlers,
}: {
  providers: readonly CustomProviderPublic[]
  editingId: string | null
  handlers: CustomProvidersHandlers
}) {
  const form = useCustomProvidersSectionStore((state) => state.editorForm)
  const patchEditorForm = useCustomProvidersSectionStore((state) => state.patchEditorForm)
  const setLabel = useCustomProvidersSectionStore((state) => state.setLabel)
  const setId = useCustomProvidersSectionStore((state) => state.setId)
  const setModelField = useCustomProvidersSectionStore((state) => state.setModelField)
  const addModelRow = useCustomProvidersSectionStore((state) => state.addModelRow)
  const removeModelRow = useCustomProvidersSectionStore((state) => state.removeModelRow)
  const discardEditor = useCustomProvidersSectionStore((state) => state.discardEditor)

  const isEdit = editingId !== null
  const mode = isEdit ? "edit" : "create"
  const existing = useMemo(
    () => providers.find((provider) => provider.id === editingId) ?? null,
    [providers, editingId],
  )
  const otherIds = useMemo(
    () => providers.filter((provider) => provider.id !== editingId).map((provider) => provider.id),
    [providers, editingId],
  )
  const saveKey = pendingActionKey("settings.customProviders", editingId ?? "new")
  const savePending = usePendingAction(saveKey)

  const handleLabelChange = useCallback((value: string) => {
    setLabel(value, otherIds)
  }, [otherIds, setLabel])

  const handleSave = useCallback(() => {
    const message = validateDraft(form, mode, otherIds)
    if (message !== null) {
      patchEditorForm({ error: message })
      return
    }
    runPendingAction(saveKey, () =>
      submitEditorForm({
        patch: patchEditorForm,
        save: async () => {
          if (editingId !== null) {
            await handlers.onUpdate(editingId, buildUpdatePatch(form))
          } else {
            await handlers.onCreate(buildCreateInput(form))
          }
        },
        onDone: discardEditor,
      }),
    )
  }, [discardEditor, editingId, form, handlers, mode, otherIds, patchEditorForm, saveKey])

  const busy = savePending

  return (
    <div className="flex flex-col gap-4 rounded-md border border-border px-4 py-4">
      <h3 className="text-sm font-medium">{isEdit ? `Edit ${existing?.label ?? editingId}` : "Add endpoint"}</h3>

      {form.hint ? <p className="text-xs text-muted-foreground">{form.hint}</p> : null}

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Label</span>
        <Input
          value={form.label}
          onChange={(event) => handleLabelChange(event.target.value)}
          maxLength={CUSTOM_PROVIDER_LABEL_MAX}
          placeholder="GLM (Z.AI)"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Id</span>
        <Input
          value={form.id}
          onChange={(event) => setId(event.target.value)}
          disabled={isEdit}
          placeholder="glm"
          className="font-mono"
        />
        <span className="text-xs text-muted-foreground">
          Part of every model id, so it cannot change after the endpoint is created.
        </span>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Base URL</span>
        <Input
          value={form.baseUrl}
          onChange={(event) => patchEditorForm({ baseUrl: event.target.value })}
          placeholder="https://api.example.com/anthropic"
          className="font-mono"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">API key</span>
        <Input
          type="password"
          autoComplete="off"
          value={form.apiKey}
          onChange={(event) => patchEditorForm({ apiKey: event.target.value })}
          maxLength={CUSTOM_PROVIDER_API_KEY_MAX}
          placeholder={keyPlaceholder(mode, existing?.apiKeyHint ?? null)}
          className="font-mono"
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Context window (tokens)</span>
        <Input
          inputMode="numeric"
          value={form.contextWindow}
          onChange={(event) => patchEditorForm({ contextWindow: event.target.value })}
          placeholder="200000"
          className="font-mono tabular-nums"
        />
        <span className="text-xs text-muted-foreground">
          The model's real context window. The agent compacts the conversation before reaching it. Leave empty to assume 200,000. For Ollama use your OLLAMA_CONTEXT_LENGTH.
        </span>
      </label>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">Models</span>
        {form.models.map((model, index) => (
          <div key={index} className="flex items-center gap-2">
            <Input
              value={model.id}
              onChange={(event) => setModelField(index, "id", event.target.value)}
              maxLength={CUSTOM_PROVIDER_MODEL_ID_MAX}
              placeholder="Model id"
              aria-label={`Model ${index + 1} id`}
              className="font-mono"
            />
            <Input
              value={model.label}
              onChange={(event) => setModelField(index, "label", event.target.value)}
              maxLength={CUSTOM_PROVIDER_MODEL_LABEL_MAX}
              placeholder="Label (optional)"
              aria-label={`Model ${index + 1} label`}
            />
            <Button
              variant="ghost"
              size="sm"
              onClick={() => removeModelRow(index)}
              aria-label={`Remove model ${index + 1}`}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        ))}
        <div>
          <Button variant="ghost" size="sm" onClick={addModelRow}>
            <Plus className="mr-1 h-4 w-4" />
            Add model
          </Button>
        </div>
      </div>

      {form.error ? (
        <div role="alert" className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {form.error}
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button onClick={handleSave} pending={busy}>
          {editorSubmitLabel({ submitting: busy, isEdit, addLabel: "Add endpoint" })}
        </Button>
        <Button variant="ghost" onClick={discardEditor} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

export function CustomProvidersSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings">
}) {
  const providers = useAppSettingsStore(selectCustomProviders)
  const handlers = useAppSettingsCrudHandlers("customProviders", props.state)
  return <CustomProvidersSection providers={providers} handlers={handlers} />
}
