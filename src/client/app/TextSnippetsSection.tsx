import { useMemo } from "react"
import { Plus, Type } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import {
  SettingsEmptyState,
  SettingsList,
  SettingsRowActions,
} from "../components/settings/SettingsList"
import { useAppSettingsStore, selectTextSnippets } from "../stores/appSettingsStore"
import type { TextSnippet, TextSnippetInput, TextSnippetPatch } from "../../shared/types"
import type { KannaState } from "./useKannaState"
import {
  useAppSettingsCrudHandlers,
  type AppSettingsCrudHandlers,
  type AppSettingsPatchWrapper,
} from "./appSettingsCrud"
import { editorSubmitLabel, submitEditorForm } from "./settingsEditorForm"
import {
  useTextSnippetsSectionStore,
  type SnippetEditingState,
} from "../stores/textSnippetsSectionStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"

export type TextSnippetsSectionHandlers = AppSettingsCrudHandlers<
  TextSnippetInput,
  TextSnippetPatch
>

const wrapSnippetsPatch: AppSettingsPatchWrapper<TextSnippetInput, TextSnippetPatch> = (
  textSnippets,
) => ({ textSnippets })

interface TextSnippetsSectionProps {
  snippets: readonly TextSnippet[]
  handlers: TextSnippetsSectionHandlers
  dom?: DomPort
}

const SHORTCUT_REGEX = /^\S{1,32}$/

export function TextSnippetsSection({ snippets, handlers, dom = domAdapter }: TextSnippetsSectionProps) {
  const editing = useTextSnippetsSectionStore((state) => state.editing)
  const setEditing = useTextSnippetsSectionStore((state) => state.setEditing)
  const resetEditorForm = useTextSnippetsSectionStore((state) => state.resetEditorForm)

  function navigate(next: SnippetEditingState) {
    if (next.kind === "create") {
      resetEditorForm("", "")
    } else if (next.kind === "edit") {
      const initial = snippets.find((s) => s.id === next.id) ?? null
      if (initial) {
        resetEditorForm(initial.shortcut, initial.expansion)
      }
    }
    setEditing(next)
  }

  if (editing.kind !== "list") {
    const initial =
      editing.kind === "edit" ? (snippets.find((s) => s.id === editing.id) ?? null) : null
    return (
      <SnippetEditor
        initial={initial}
        existing={snippets.map((s) => ({ id: s.id, shortcut: s.shortcut }))}
        handlers={handlers}
        onDone={() => setEditing({ kind: "list" })}
      />
    )
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Text snippets</h2>
          <p className="max-w-[65ch] text-sm text-muted-foreground">
            Type a shortcut in the chat composer and press Tab to expand it into the full
            text. Handy for prompts you send often.
          </p>
        </div>
        <Button size="sm" onClick={() => navigate({ kind: "create" })}>
          <Plus className="mr-1 h-4 w-4" />
          Add snippet
        </Button>
      </div>

      {snippets.length === 0 ? (
        <SettingsEmptyState
          icon={Type}
          message="No snippets yet. Add one to expand a shortcut with Tab."
        />
      ) : (
        <SettingsList>
          {snippets.map((snippet) => (
            <SnippetRow
              key={snippet.id}
              snippet={snippet}
              onEdit={() => navigate({ kind: "edit", id: snippet.id })}
              onDelete={() => {
                if (dom.confirmDialog(`Delete snippet "${snippet.shortcut}"?`)) {
                  void handlers.onDelete(snippet.id)
                }
              }}
            />
          ))}
        </SettingsList>
      )}
    </div>
  )
}

function SnippetRow({
  snippet,
  onEdit,
  onDelete,
}: {
  snippet: TextSnippet
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="font-mono text-sm">{snippet.shortcut}</span>
        <span className="truncate text-xs text-muted-foreground">{snippet.expansion}</span>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <SettingsRowActions label={snippet.shortcut} onEdit={onEdit} onDelete={onDelete} />
      </div>
    </li>
  )
}


function SnippetEditor({
  initial,
  existing,
  handlers,
  onDone,
}: {
  initial: TextSnippet | null
  existing: ReadonlyArray<{ id: string; shortcut: string }>
  handlers: TextSnippetsSectionHandlers
  onDone: () => void
}) {
  const editorForm = useTextSnippetsSectionStore((state) => state.editorForm)
  const patchEditorForm = useTextSnippetsSectionStore((state) => state.patchEditorForm)

  const { shortcut, expansion, submitting, error } = editorForm

  const isEdit = initial !== null
  const trimmedShortcut = shortcut.trim()
  const shortcutValid = SHORTCUT_REGEX.test(trimmedShortcut)
  const duplicate = useMemo(
    () => existing.some((s) => s.shortcut === trimmedShortcut && s.id !== initial?.id),
    [existing, trimmedShortcut, initial?.id],
  )

  const canSave = shortcutValid && !duplicate && expansion.length > 0 && !submitting

  const onSubmit = () =>
    submitEditorForm({
      patch: patchEditorForm,
      save: async () => {
        if (isEdit && initial) {
          await handlers.onUpdate(initial.id, { shortcut: trimmedShortcut, expansion })
        } else {
          await handlers.onCreate({ shortcut: trimmedShortcut, expansion })
        }
      },
      onDone,
      fallbackMessage: "Failed to save snippet",
    })

  const submitLabel = editorSubmitLabel({ submitting, isEdit, addLabel: "Add snippet" })

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <h2 className="text-base font-medium">{isEdit ? "Edit snippet" : "Add snippet"}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Shortcut</span>
        <Input
          value={shortcut}
          onChange={(e) => patchEditorForm({ shortcut: e.target.value })}
          placeholder="pgm"
          className="font-mono"
          autoFocus
        />
        {shortcut.length > 0 && !shortcutValid && (
          <span className="text-xs text-destructive">
            Shortcut must be 1-32 characters with no spaces.
          </span>
        )}
        {duplicate && (
          <span className="text-xs text-destructive">A snippet with this shortcut already exists.</span>
        )}
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Expands to</span>
        <Textarea
          value={expansion}
          onChange={(e) => patchEditorForm({ expansion: e.target.value })}
          placeholder="pull request green then merge"
          rows={4}
        />
      </label>

      {error && <span className="text-xs text-destructive">{error}</span>}

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


export function TextSnippetsSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings">
}) {
  const snippets = useAppSettingsStore(selectTextSnippets)
  const handlers = useAppSettingsCrudHandlers(wrapSnippetsPatch, props.state)
  return <TextSnippetsSection snippets={snippets} handlers={handlers} />
}
