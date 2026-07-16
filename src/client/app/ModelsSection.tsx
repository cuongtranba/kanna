import { useMemo } from "react"
import { Plus, Trash2, Pencil, Cpu } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../components/ui/select"
import { useAppSettingsStore, selectCustomModels } from "../stores/appSettingsStore"
import type {
  AppSettingsPatch,
  CustomModelEntry,
  CustomModelInput,
  CustomModelPatch,
} from "../../shared/types"
import type { KannaState } from "./useKannaState"
import {
  useModelsSectionStore,
  type ModelProvider,
  type ModelsEditingState,
} from "../stores/modelsSectionStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export interface ModelsSectionHandlers {
  onCreate: (input: CustomModelInput) => Promise<void>
  onUpdate: (id: string, patch: CustomModelPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

const MODEL_PROVIDER_SET = new Set<string>(["claude", "codex"])
function isModelProvider(v: string): v is ModelProvider {
  return MODEL_PROVIDER_SET.has(v)
}

interface ModelsSectionProps {
  models: readonly CustomModelEntry[]
  handlers: ModelsSectionHandlers
  dom?: DomPort
}

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  claude: "Claude",
  codex: "Codex",
}

export function ModelsSection({ models, handlers, dom = domAdapter }: ModelsSectionProps) {
  const editing = useModelsSectionStore((state) => state.editing)
  const setEditing = useModelsSectionStore((state) => state.setEditing)
  const resetEditorForm = useModelsSectionStore((state) => state.resetEditorForm)

  function navigate(next: ModelsEditingState) {
    if (next.kind === "create") {
      resetEditorForm("", "", next.provider, false)
    } else if (next.kind === "edit") {
      const initial = models.find((m) => m.id === next.id) ?? null
      if (initial) {
        resetEditorForm(initial.id, initial.label, initial.provider, initial.supportsEffort ?? false)
      }
    }
    setEditing(next)
  }

  if (editing.kind !== "list") {
    const initial =
      editing.kind === "edit" ? (models.find((m) => m.id === editing.id) ?? null) : null
    return (
      <ModelEditor
        initial={initial}
        existing={models.map((m) => ({ id: m.id, provider: m.provider }))}
        handlers={handlers}
        onDone={() => setEditing({ kind: "list" })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      {(["claude", "codex"] as const).map((provider) => {
        const rows = models.filter((m) => m.provider === provider)
        return (
          <div key={provider} className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-medium">{PROVIDER_LABEL[provider]} models</h2>
              <Button size="sm" onClick={() => navigate({ kind: "create", provider })}>
                <Plus className="mr-1 h-4 w-4" />
                Add model
              </Button>
            </div>
            {rows.length === 0 ? (
              <div className="flex flex-col items-center justify-center rounded-md border border-dashed px-6 py-10 text-center">
                <Cpu className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
                <p className="text-sm text-muted-foreground">
                  No {PROVIDER_LABEL[provider]} models configured.
                </p>
              </div>
            ) : (
              <ul className="flex flex-col divide-y rounded-md border">
                {rows.map((model) => (
                  <ModelRow
                    key={model.id}
                    model={model}
                    onEdit={() => navigate({ kind: "edit", id: model.id })}
                    onDelete={() => {
                      if (dom.confirmDialog(`Delete model "${model.label}"?`)) {
                        void handlers.onDelete(model.id)
                      }
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ModelRow({
  model,
  onEdit,
  onDelete,
}: {
  model: CustomModelEntry
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex flex-col">
        <span className="font-medium">{model.label}</span>
        <span className="font-mono text-xs text-muted-foreground">{model.id}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        {model.supportsEffort && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">effort</span>
        )}
        {model.supportsMaxReasoningEffort && (
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase">max</span>
        )}
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${model.label}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} aria-label={`Delete ${model.label}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  )
}

// ── Editor form ─────────────────────────────────────────────────────────────

function ModelEditor({
  initial,
  existing,
  handlers,
  onDone,
}: {
  initial: CustomModelEntry | null
  existing: ReadonlyArray<{ id: string; provider: string }>
  handlers: ModelsSectionHandlers
  onDone: () => void
}) {
  const editorForm = useModelsSectionStore((state) => state.editorForm)
  const setEditorId = useModelsSectionStore((state) => state.setEditorId)
  const setEditorLabel = useModelsSectionStore((state) => state.setEditorLabel)
  const setEditorModelProvider = useModelsSectionStore((state) => state.setEditorModelProvider)
  const setEditorSupportsEffort = useModelsSectionStore((state) => state.setEditorSupportsEffort)
  const setEditorSubmitting = useModelsSectionStore((state) => state.setEditorSubmitting)
  const setEditorError = useModelsSectionStore((state) => state.setEditorError)

  const { id, label, modelProvider, supportsEffort, submitting, error } = editorForm

  const isEdit = initial !== null

  const duplicate = useMemo(
    () =>
      !isEdit
      && existing.some((m) => m.id === id.trim() && m.provider === modelProvider),
    [existing, id, isEdit, modelProvider],
  )

  const canSave = id.trim().length > 0 && label.trim().length > 0 && !duplicate && !submitting

  const onSubmit = async () => {
    setEditorSubmitting(true)
    setEditorError(null)
    try {
      if (isEdit && initial) {
        await handlers.onUpdate(initial.id, { label: label.trim(), supportsEffort })
      } else {
        await handlers.onCreate({
          id: id.trim(),
          label: label.trim(),
          provider: modelProvider,
          supportsEffort,
        })
      }
      onDone()
    } catch (e) {
      setEditorError(e instanceof Error ? e.message : "Failed to save model")
    } finally {
      setEditorSubmitting(false)
    }
  }

  let submitLabel: string
  if (submitting) {
    submitLabel = "Saving…"
  } else if (isEdit) {
    submitLabel = "Save changes"
  } else {
    submitLabel = "Add model"
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <h2 className="text-base font-medium">{isEdit ? "Edit model" : "Add model"}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Provider</span>
        <Select
          value={modelProvider}
          onValueChange={(value) => { if (isModelProvider(value)) setEditorModelProvider(value) }}
          disabled={isEdit}
        >
          <SelectTrigger className="min-w-[180px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="claude">Claude</SelectItem>
            <SelectItem value="codex">Codex</SelectItem>
          </SelectContent>
        </Select>
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Model ID</span>
        <Input
          value={id}
          onChange={(e) => setEditorId(e.target.value)}
          placeholder="claude-opus-4-9"
          disabled={isEdit}
          className="font-mono"
        />
        {duplicate && (
          <span className="text-xs text-red-600">A model with this id already exists.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Label</span>
        <Input value={label} onChange={(e) => setEditorLabel(e.target.value)} placeholder="Opus 4.9" />
      </label>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={supportsEffort}
          onChange={(e) => setEditorSupportsEffort(e.target.checked)}
        />
        <span>Supports reasoning effort</span>
      </label>

      {error && <span className="text-xs text-red-600">{error}</span>}

      <div className="flex items-center gap-2">
        <Button
          onClick={() => {
            void onSubmit()
          }}
          disabled={!canSave}
        >
          {submitLabel}
        </Button>
        <Button variant="ghost" onClick={onDone} disabled={submitting}>
          Cancel
        </Button>
      </div>
    </div>
  )
}

// ── Settings page wrapper ─────────────────────────────────────────────────

export function ModelsSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings">
}) {
  const models = useAppSettingsStore(selectCustomModels)
  const handlers = useMemo<ModelsSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        const s: AppSettingsPatch = { customModels: { create: input } }
        await props.state.handleWriteAppSettings(s)
      },
      onUpdate: async (id, patch) => {
        const s: AppSettingsPatch = { customModels: { update: { id, patch } } }
        await props.state.handleWriteAppSettings(s)
      },
      onDelete: async (id) => {
        const s: AppSettingsPatch = { customModels: { delete: { id } } }
        await props.state.handleWriteAppSettings(s)
      },
    }),
    [props.state],
  )
  return <ModelsSection models={models} handlers={handlers} />
}
