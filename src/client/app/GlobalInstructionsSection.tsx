import { useCallback, useEffect } from "react"
import { GLOBAL_PROMPT_APPEND_MAX_CHARS } from "../../shared/types"
import { Button } from "../components/ui/button"
import { SettingsRow } from "../components/settings/SettingsList"
import { surfaceErrorIn } from "../lib/commandFeedback"
import { cn } from "../lib/utils"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useGlobalInstructionsStore } from "../stores/globalInstructionsStore"
import { runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import type { KannaState } from "./useKannaState"

const GLOBAL_INSTRUCTIONS_SAVE_KEY = "settings.globalInstructions"

export function GlobalInstructionsSection({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const persisted = useAppSettingsStore((s) => s.settings?.globalPromptAppend ?? "")
  const draft = useGlobalInstructionsStore((s) => s.draft)
  const setDraft = useGlobalInstructionsStore((s) => s.setDraft)
  const persistedAtMount = useGlobalInstructionsStore((s) => s.persistedAtMount)
  const persistedChanged = useGlobalInstructionsStore((s) => s.persistedChanged)
  const saving = usePendingAction(GLOBAL_INSTRUCTIONS_SAVE_KEY)
  const error = useGlobalInstructionsStore((s) => s.error)
  const setError = useGlobalInstructionsStore((s) => s.setError)

  useEffect(() => {
    if (persisted !== persistedAtMount) persistedChanged(persisted)
  }, [persisted, persistedAtMount, persistedChanged])

  const trimmed = draft.replace(/\s+$/u, "")
  const overCap = trimmed.length > GLOBAL_PROMPT_APPEND_MAX_CHARS
  const dirty = trimmed !== persisted
  const saveDisabled = saving || overCap || !dirty

  const onSave = useCallback(async () => {
    if (saveDisabled) return
    await surfaceErrorIn(setError, () => state.handleWriteAppSettings({ globalPromptAppend: trimmed }))
  }, [saveDisabled, state, trimmed, setError])

  let saveLabel: string
  if (saving) {
    saveLabel = "Saving…"
  } else if (dirty) {
    saveLabel = "Save"
  } else {
    saveLabel = "Saved"
  }

  return (
    <div className="border-b border-border">
      <SettingsRow
        title="Global Instructions"
        description="Appended to every Claude and Codex turn — including subagent turns — as “Workspace instructions”. Kanna does not read CLAUDE.md or AGENTS.md from disk; paste your global instructions here. For rules that apply to one project only, use “Edit instructions” in that project's sidebar menu. Leave blank to disable."
        bordered={false}
        alignStart
      >
        <div className="flex w-full flex-col gap-2 md:w-[420px]">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="e.g. Always write tests before implementation. Prefer Tailwind classes over inline styles."
            rows={8}
            aria-label="Global instructions"
            className={cn(
              "min-h-[160px] w-full resize-y rounded-md border bg-background px-3 py-2 text-sm shadow-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50",
              overCap ? "border-destructive" : "border-input",
            )}
            disabled={saving}
          />
          <div className="flex items-center justify-between text-xs">
            <span className={overCap ? "text-destructive" : "text-muted-foreground"}>
              {trimmed.length} / {GLOBAL_PROMPT_APPEND_MAX_CHARS} characters
              {overCap ? " — over limit" : ""}
            </span>
            <Button
              type="button"
              size="sm"
              onClick={() => runPendingAction(GLOBAL_INSTRUCTIONS_SAVE_KEY, onSave)}
              disabled={saveDisabled}
              pending={saving}
            >
              {saveLabel}
            </Button>
          </div>
          {error ? (
            <div className="text-xs text-destructive">{error}</div>
          ) : null}
        </div>
      </SettingsRow>
    </div>
  )
}
