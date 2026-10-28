import { useCallback } from "react"
import { ChevronDown, ChevronUp, Trash2, X } from "lucide-react"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { ColorChoice } from "./ColorChoice"
import { CardSchemaStore } from "./CardSchemaPanel.store"
import { FIELD_KIND_LABELS, missingLoadBearingIds } from "../../lib/boards/cardSchemaDraft"
import { loadBearingFieldNote } from "../../../shared/boards/well-known-fields"
import {
  COLUMN_COLOR_TOKENS,
  FIELD_KINDS,
  type FieldDef,
  type FieldOption,
} from "../../../shared/boards/types"
import { onRejected } from "../../../shared/errors"
import type { CommandPort } from "../../ports/commandPort"


export type CardSchemaPanelSocket = CommandPort

export interface CardSchemaPanelProps {
  boardId: string
  fields: readonly FieldDef[]
  socket: CardSchemaPanelSocket
  onClose: () => void
}

export function CardSchemaPanel({ fields, ...rest }: CardSchemaPanelProps) {
  return (
    <CardSchemaStore.Provider init={fields}>
      <CardSchemaPanelBody {...rest} />
    </CardSchemaStore.Provider>
  )
}

function CardSchemaPanelBody({ boardId, socket, onClose }: Omit<CardSchemaPanelProps, "fields">) {
  const schema = CardSchemaStore.useScopedStoreApi()
  const draft = CardSchemaStore.useScopedStore((state) => state.draft)
  const newLabel = CardSchemaStore.useScopedStore((state) => state.newLabel)
  const newKind = CardSchemaStore.useScopedStore((state) => state.newKind)
  const saving = CardSchemaStore.useScopedStore((state) => state.saving)
  const error = CardSchemaStore.useScopedStore((state) => state.error)

  const handleNewLabel = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    schema.getState().setNewLabel(event.currentTarget.value)
  }, [schema])

  const handleNewKind = useCallback((event: React.ChangeEvent<HTMLSelectElement>) => {
    schema.getState().setNewKind(event.currentTarget.value)
  }, [schema])

  const handleAddField = useCallback(() => {
    schema.getState().addField()
  }, [schema])

  const handleSave = useCallback(() => {
    const state = schema.getState()
    state.beginSave()
    void socket
      .command({ type: "board.update", boardId, cardFields: state.draft })
      .then(() => {
        schema.getState().endSave(null)
        onClose()
      })
      .catch(onRejected((error) => {
        schema.getState().endSave(error.message)
      }))
  }, [boardId, onClose, socket, schema])

  const missing = missingLoadBearingIds(draft)

  return (
    <aside
      className="absolute inset-y-0 right-0 z-20 flex w-full flex-col border-l border-border bg-background sm:w-[400px]"
      aria-label="Card fields"
    >
      <header className="flex items-start gap-2 border-b border-border px-4 py-3">
        <h2 className="min-w-0 flex-1 text-15 font-semibold leading-snug text-foreground">Card fields</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close card fields"
          className="rounded-md p-1 text-muted-foreground hover:bg-secondary"
        >
          <X className="size-4" />
        </button>
      </header>

      {error ? <p className="px-4 py-2 text-13 text-destructive-text">{error}</p> : null}

      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-4 py-4">
        <p className="text-13 text-muted-foreground [text-wrap:pretty]">
          What every card on this board has, in the order the card opens them. Cards keep the values of a
          field you remove, and get them back if you add it again.
        </p>

        {draft.length === 0 ? (
          <p className="text-13 text-muted-foreground">
            No fields yet, so cards on this board are title-only.
          </p>
        ) : (
          <ul className="space-y-4">
            {draft.map((field, index) => (
              <FieldRow key={field.id} field={field} first={index === 0} last={index === draft.length - 1} />
            ))}
          </ul>
        )}

        <section className="space-y-2 border-t border-border pt-4">
          <p className="text-xs font-medium text-muted-foreground">Add a field</p>
          <div className="flex items-center gap-1.5">
            <Input
              aria-label="New field name"
              value={newLabel}
              onChange={handleNewLabel}
              placeholder="Name"
              className="min-w-0 flex-1"
            />
            <select
              aria-label="New field kind"
              value={newKind}
              onChange={handleNewKind}
              className="rounded-md border border-border bg-background px-2 py-1.5 text-13 text-foreground"
            >
              {FIELD_KINDS.map((kind) => (
                <option key={kind} value={kind}>
                  {FIELD_KIND_LABELS[kind]}
                </option>
              ))}
            </select>
          </div>
          <Button size="sm" variant="secondary" onClick={handleAddField} disabled={newLabel.trim() === ""}>
            Add field
          </Button>
          {missing.length > 0 ? (
            <p className="text-13 text-muted-foreground [text-wrap:pretty]">
              Not on this board: <span className="font-mono text-xs">{missing.join(", ")}</span>. GitHub sync
              and Start work read those ids by name, and quietly do less without them.
            </p>
          ) : null}
        </section>
      </div>

      <footer className="flex items-center gap-2 border-t border-border px-4 py-3">
        <Button size="sm" onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save"}
        </Button>
        <span className="text-13 text-muted-foreground">Nothing is written until you save.</span>
      </footer>
    </aside>
  )
}

function FieldRow({ field, first, last }: { field: FieldDef; first: boolean; last: boolean }) {
  const schema = CardSchemaStore.useScopedStoreApi()
  const pendingRemoval = CardSchemaStore.useScopedStore((state) => state.pendingRemovalFieldId === field.id)
  const optionDraft = CardSchemaStore.useScopedStore((state) => state.optionDraftByField[field.id] ?? "")

  const fieldId = field.id
  const handleRename = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      schema.getState().renameField(fieldId, event.currentTarget.value)
    },
    [fieldId, schema],
  )
  const handleUp = useCallback(() => {
    schema.getState().moveField(fieldId, -1)
  }, [fieldId, schema])
  const handleDown = useCallback(() => {
    schema.getState().moveField(fieldId, 1)
  }, [fieldId, schema])
  const handleRequired = useCallback(() => {
    schema.getState().toggleRequired(fieldId)
  }, [fieldId, schema])
  const handleAskRemove = useCallback(() => {
    schema.getState().askRemoveField(fieldId)
  }, [fieldId, schema])
  const handleKeep = useCallback(() => {
    schema.getState().cancelRemoveField()
  }, [schema])
  const handleRemove = useCallback(() => {
    schema.getState().removeField(fieldId)
  }, [fieldId, schema])
  const handleOptionDraft = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      schema.getState().setOptionDraft(fieldId, event.currentTarget.value)
    },
    [fieldId, schema],
  )
  const handleAddOption = useCallback(() => {
    schema.getState().addOption(fieldId)
  }, [fieldId, schema])

  const note = loadBearingFieldNote(field.id)

  return (
    <li className="space-y-2">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={`Name of the ${field.id} field`}
          value={field.label}
          onChange={handleRename}
          className="min-w-0 flex-1"
        />
        <RowButton label={`Move ${field.label} up`} onClick={handleUp} disabled={first}>
          <ChevronUp aria-hidden className="size-4" />
        </RowButton>
        <RowButton label={`Move ${field.label} down`} onClick={handleDown} disabled={last}>
          <ChevronDown aria-hidden className="size-4" />
        </RowButton>
        <RowButton label={`Remove ${field.label}`} onClick={handleAskRemove} destructive>
          <Trash2 aria-hidden className="size-4" />
        </RowButton>
      </div>

      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-13 text-muted-foreground">
        <span className="font-mono text-xs">{field.id}</span>
        <span aria-hidden>·</span>
        <span>{FIELD_KIND_LABELS[field.kind]}</span>
        <label className="ml-auto flex items-center gap-1.5">
          <input
            type="checkbox"
            aria-label={`${field.label} is required`}
            checked={field.required}
            onChange={handleRequired}
            className="accent-primary"
          />
          <span>Required</span>
        </label>
      </div>

      {pendingRemoval ? (
        <div className="space-y-2 rounded-md border border-border p-2">
          <p className="text-13 text-foreground [text-wrap:pretty]">
            Remove {field.label}? Cards keep the values they already have, and get them back if this field
            comes back.
          </p>
          {note ? <p className="text-13 text-destructive-text [text-wrap:pretty]">{note}</p> : null}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" className="text-destructive-text" onClick={handleRemove}>
              Remove
            </Button>
            <Button size="sm" variant="secondary" onClick={handleKeep}>
              Keep
            </Button>
          </div>
        </div>
      ) : null}

      {field.options === null ? null : (
        <div className="space-y-2 border-l border-border pl-3">
          <p className="text-xs font-medium text-muted-foreground">Options</p>
          {field.options.length === 0 ? (
            <p className="text-13 text-muted-foreground">No options yet, so this field offers nothing.</p>
          ) : (
            <ul className="space-y-2">
              {field.options.map((option) => (
                <OptionRow key={option.id} fieldId={field.id} option={option} />
              ))}
            </ul>
          )}
          <div className="flex items-center gap-1.5">
            <Input
              aria-label={`New option for ${field.label}`}
              value={optionDraft}
              onChange={handleOptionDraft}
              placeholder="Name"
              className="min-w-0 flex-1"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={handleAddOption}
              disabled={optionDraft.trim() === ""}
            >
              Add option
            </Button>
          </div>
        </div>
      )}
    </li>
  )
}

function OptionRow({ fieldId, option }: { fieldId: string; option: FieldOption }) {
  const schema = CardSchemaStore.useScopedStoreApi()
  const optionId = option.id
  const handleRename = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      schema.getState().renameOption(fieldId, optionId, event.currentTarget.value)
    },
    [fieldId, optionId, schema],
  )
  const handleColor = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>) => {
      schema.getState().setOptionColor(fieldId, optionId, event.currentTarget.value)
    },
    [fieldId, optionId, schema],
  )
  const handleRemove = useCallback(() => {
    schema.getState().removeOption(fieldId, optionId)
  }, [fieldId, optionId, schema])

  return (
    <li className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        <Input
          aria-label={`Name of the ${option.id} option`}
          value={option.label}
          onChange={handleRename}
          className="min-w-0 flex-1"
        />
        <RowButton label={`Remove option ${option.label}`} onClick={handleRemove} destructive>
          <Trash2 aria-hidden className="size-4" />
        </RowButton>
      </div>
      <div className="flex items-center gap-1.5">
        <ColorChoice
          token={null}
          label={`Colour ${option.id} none`}
          selected={option.colorToken === null}
          onSelect={handleColor}
        />
        {COLUMN_COLOR_TOKENS.map((token) => (
          <ColorChoice
            key={token}
            token={token}
            label={`Colour ${option.id} ${token}`}
            selected={option.colorToken === token}
            onSelect={handleColor}
          />
        ))}
      </div>
    </li>
  )
}

function RowButton({
  label,
  onClick,
  disabled,
  destructive,
  children,
}: {
  label: string
  onClick: () => void
  disabled?: boolean
  destructive?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={
        destructive
          ? "shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-destructive-text disabled:opacity-40"
          : "shrink-0 rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground disabled:opacity-40"
      }
    >
      {children}
    </button>
  )
}
