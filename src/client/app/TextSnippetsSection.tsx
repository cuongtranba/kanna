import { useMemo, useState } from "react"
import { Plus, Trash2, Pencil, Type } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { Textarea } from "../components/ui/textarea"
import { useAppSettingsStore, selectTextSnippets } from "../stores/appSettingsStore"
import type {
  AppSettingsPatch,
  TextSnippet,
  TextSnippetInput,
  TextSnippetPatch,
} from "../../shared/types"
import type { KannaState } from "./useKannaState"

export interface TextSnippetsSectionHandlers {
  onCreate: (input: TextSnippetInput) => Promise<void>
  onUpdate: (id: string, patch: TextSnippetPatch) => Promise<void>
  onDelete: (id: string) => Promise<void>
}

type EditingState =
  | { kind: "list" }
  | { kind: "create" }
  | { kind: "edit"; id: string }

interface TextSnippetsSectionProps {
  snippets: readonly TextSnippet[]
  handlers: TextSnippetsSectionHandlers
}

const SHORTCUT_REGEX = /^\S{1,32}$/

export function TextSnippetsSection({ snippets, handlers }: TextSnippetsSectionProps) {
  const [editing, setEditing] = useState<EditingState>({ kind: "list" })

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
        <Button size="sm" onClick={() => setEditing({ kind: "create" })}>
          <Plus className="mr-1 h-4 w-4" />
          Add snippet
        </Button>
      </div>

      {snippets.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-md border border-dashed px-6 py-10 text-center">
          <Type className="mb-3 h-8 w-8 text-muted-foreground" aria-hidden />
          <p className="text-sm text-muted-foreground">
            No snippets yet. Add one to expand a shortcut with Tab.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col divide-y rounded-md border">
          {snippets.map((snippet) => (
            <SnippetRow
              key={snippet.id}
              snippet={snippet}
              onEdit={() => setEditing({ kind: "edit", id: snippet.id })}
              onDelete={() => {
                if (window.confirm(`Delete snippet "${snippet.shortcut}"?`)) {
                  void handlers.onDelete(snippet.id)
                }
              }}
            />
          ))}
        </ul>
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
        <Button variant="ghost" size="sm" onClick={onEdit} aria-label={`Edit ${snippet.shortcut}`}>
          <Pencil className="h-4 w-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          aria-label={`Delete ${snippet.shortcut}`}
        >
          <Trash2 className="h-4 w-4" />
        </Button>
      </div>
    </li>
  )
}

// ── Editor form ─────────────────────────────────────────────────────────────

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
  const isEdit = initial !== null
  const [shortcut, setShortcut] = useState(initial?.shortcut ?? "")
  const [expansion, setExpansion] = useState(initial?.expansion ?? "")
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedShortcut = shortcut.trim()
  const shortcutValid = SHORTCUT_REGEX.test(trimmedShortcut)
  const duplicate = useMemo(
    () => existing.some((s) => s.shortcut === trimmedShortcut && s.id !== initial?.id),
    [existing, trimmedShortcut, initial?.id],
  )

  const canSave = shortcutValid && !duplicate && expansion.length > 0 && !submitting

  const onSubmit = async () => {
    setSubmitting(true)
    setError(null)
    try {
      if (isEdit && initial) {
        await handlers.onUpdate(initial.id, { shortcut: trimmedShortcut, expansion })
      } else {
        await handlers.onCreate({ shortcut: trimmedShortcut, expansion })
      }
      onDone()
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save snippet")
    } finally {
      setSubmitting(false)
    }
  }

  let submitLabel: string
  if (submitting) {
    submitLabel = "Saving…"
  } else if (isEdit) {
    submitLabel = "Save changes"
  } else {
    submitLabel = "Add snippet"
  }

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <h2 className="text-base font-medium">{isEdit ? "Edit snippet" : "Add snippet"}</h2>

      <label className="flex flex-col gap-1">
        <span className="text-sm font-medium">Shortcut</span>
        <Input
          value={shortcut}
          onChange={(e) => setShortcut(e.target.value)}
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
          onChange={(e) => setExpansion(e.target.value)}
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

// ── Settings page wrapper ─────────────────────────────────────────────────

export function TextSnippetsSettingsBranch(props: {
  state: Pick<KannaState, "handleWriteAppSettings">
}) {
  const snippets = useAppSettingsStore(selectTextSnippets)
  const handlers = useMemo<TextSnippetsSectionHandlers>(
    () => ({
      onCreate: async (input) => {
        await props.state.handleWriteAppSettings({ textSnippets: { create: input } } as AppSettingsPatch)
      },
      onUpdate: async (id, patch) => {
        await props.state.handleWriteAppSettings({ textSnippets: { update: { id, patch } } } as AppSettingsPatch)
      },
      onDelete: async (id) => {
        await props.state.handleWriteAppSettings({ textSnippets: { delete: { id } } } as AppSettingsPatch)
      },
    }),
    [props.state],
  )
  return <TextSnippetsSection snippets={snippets} handlers={handlers} />
}
