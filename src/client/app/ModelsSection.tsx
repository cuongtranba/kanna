import { useMemo, useState } from "react"
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

export interface ModelsSectionHandlers {
  onCreate: (input: CustomModelInput) => Promise<void>
  onUpdate: (id: string, patch: CustomModelPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

type ModelProvider = "claude" | "codex"

type EditingState =
  | { kind: "list" }
  | { kind: "create"; provider: ModelProvider }
  | { kind: "edit"; id: string }

interface ModelsSectionProps {
  models: readonly CustomModelEntry[]
  handlers: ModelsSectionHandlers
}

const PROVIDER_LABEL: Record<ModelProvider, string> = {
  claude: "Claude",
  codex: "Codex",
}

export function ModelsSection({ models, handlers }: ModelsSectionProps) {
  const [editing, setEditing] = useState<EditingState>({ kind: "list" })

  if (editing.kind !== "list") {
    const initial =
      editing.kind === "edit" ? (models.find((m) => m.id === editing.id) ?? null) : null
    return (
      <ModelEditor
        initial={initial}
        provider={editing.kind === "create" ? editing.provider : (initial?.provider ?? "claude")}
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
              <Button size="sm" onClick={() => setEditing({ kind: "create", provider })}>
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
                    onEdit={() => setEditing({ kind: "edit", id: model.id })}
                    onDelete={() => {
                      if (window.confirm(`Delete model "${model.label}"?`)) {
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
  provider,
  existing,
  handlers,
  onDone,
}: {
  initial: CustomModelEntry | null
  provider: ModelProvider
  existing: ReadonlyArray<{ id: string; provider: string }>
  handlers: ModelsSectionHandlers
  onDone: () => void
}) {
  const isEdit = initial !== null
  const [id, setId] = useState(initial?.id ?? "")
  const [label, setLabel] = useState(initial?.label ?? "")
  const [modelProvider, setModelProvider] = useState<ModelProvider>(initial?.provider ?? provider)
  const [supportsEffort, setSupportsEffort] = useState(initial?.supportsEffort ?? false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const duplicate = useMemo(
    () =>
      !isEdit
      && existing.some((m) => m.id === id.trim() && m.provider === modelProvider),
    [existing, id, isEdit, modelProvider],
  )

  const canSave = id.trim().length > 0 && label.trim().length > 0 && !duplicate && !submitting

  const onSubmit = async () => {
    setSubmitting(true)
    setError(null)
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
      setError(e instanceof Error ? e.message : "Failed to save model")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <h2 className="text-base font-medium">{isEdit ? "Edit model" : "Add model"}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Provider</span>
        <Select
          value={modelProvider}
          onValueChange={(value) => setModelProvider(value as ModelProvider)}
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
          onChange={(e) => setId(e.target.value)}
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
        <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Opus 4.9" />
      </label>

      <label className="inline-flex cursor-pointer items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={supportsEffort}
          onChange={(e) => setSupportsEffort(e.target.checked)}
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
          {submitting ? "Saving…" : isEdit ? "Save changes" : "Add model"}
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
        await props.state.handleWriteAppSettings({ customModels: { create: input } } as AppSettingsPatch)
      },
      onUpdate: async (id, patch) => {
        await props.state.handleWriteAppSettings({ customModels: { update: { id, patch } } } as AppSettingsPatch)
      },
      onDelete: async (id) => {
        await props.state.handleWriteAppSettings({ customModels: { delete: { id } } } as AppSettingsPatch)
      },
    }),
    [props.state],
  )
  return <ModelsSection models={models} handlers={handlers} />
}
