import { useEffect, useMemo } from "react"
import { DEFAULT_KEYBINDINGS, KEYBINDING_ACTIONS } from "../../shared/app-settings-types"
import type { KeybindingAction } from "../../shared/app-settings-types"
import { Input } from "../components/ui/input"
import { Spinner } from "../components/ui/spinner"
import { SettingsRow } from "../components/settings/SettingsList"
import {
  KEYBINDING_ACTION_LABELS,
  formatKeybindingInput,
  getResolvedKeybindings,
  parseKeybindingInput,
} from "../lib/keybindings"
import { handleTextInputKeyDown } from "../lib/settings-input"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { useSettingsPageStore } from "../stores/settingsPageStore"
import type { KannaState } from "./useKannaState"

function buildKeybindingPayload(source: Record<string, string>): Record<KeybindingAction, string[]> {
  const drafted: Partial<Record<KeybindingAction, string[]>> = {}
  for (const action of KEYBINDING_ACTIONS) {
    drafted[action] = parseKeybindingInput(source[action] ?? "")
  }
  return { ...DEFAULT_KEYBINDINGS, ...drafted }
}

function keybindingWriteKey(action: KeybindingAction): string {
  return pendingActionKey("settings.writeKeybindings", action)
}

interface KeybindingRowProps {
  action: KeybindingAction
  currentValue: string
  bordered: boolean
  onDraftChange: (action: KeybindingAction, value: string) => void
  onCommit: () => Promise<void>
  onRestoreDefault: (action: KeybindingAction) => Promise<void>
}

function KeybindingRow({ action, currentValue, bordered, onDraftChange, onCommit, onRestoreDefault }: KeybindingRowProps) {
  const writeKey = keybindingWriteKey(action)
  const pending = usePendingAction(writeKey)
  const defaultValue = formatKeybindingInput(DEFAULT_KEYBINDINGS[action])
  const showRestore = currentValue !== defaultValue
  const commit = () => {
    runPendingAction(writeKey, onCommit)
  }

  return (
    <SettingsRow
      title={KEYBINDING_ACTION_LABELS[action]}
      description={(
        <>
          <span>Comma-separated shortcuts.</span>
          {showRestore ? (
            <>
              <span> </span>
              <button
                type="button"
                disabled={pending}
                aria-busy={pending || undefined}
                onClick={() => {
                  runPendingAction(writeKey, () => onRestoreDefault(action))
                }}
                className="inline rounded text-foreground hover:text-foreground/80 disabled:opacity-60"
              >
                Restore: {defaultValue}
              </button>
            </>
          ) : null}
        </>
      )}
      bordered={bordered}
    >
      <div className="flex min-w-0 max-w-[420px] flex-1 items-center gap-2">
        <Input
          type="text"
          value={currentValue}
          aria-busy={pending || undefined}
          onChange={(event) => onDraftChange(action, event.target.value)}
          onBlur={commit}
          onKeyDown={(event) => handleTextInputKeyDown(event, commit)}
          className="font-mono"
        />
        {pending ? <Spinner /> : null}
      </div>
    </SettingsRow>
  )
}

export function KeybindingsSection({ state }: { state: KannaState }) {
  const keybindingDrafts = useSettingsPageStore((s) => s.keybindingDrafts)
  const setKeybindingDrafts = useSettingsPageStore((s) => s.setKeybindingDrafts)
  const setKeybindingDraft = useSettingsPageStore((s) => s.setKeybindingDraft)
  const keybindingsError = useSettingsPageStore((s) => s.keybindingsError)
  const setKeybindingsError = useSettingsPageStore((s) => s.setKeybindingsError)
  const resolvedKeybindings = useMemo(() => getResolvedKeybindings(state.keybindings), [state.keybindings])

  useEffect(() => {
    setKeybindingDrafts(Object.fromEntries(
      KEYBINDING_ACTIONS.map((action) => [
        action,
        formatKeybindingInput(resolvedKeybindings.bindings[action]),
      ])
    ))
  }, [resolvedKeybindings, setKeybindingDrafts])

  async function writeKeybindings(drafts: Record<string, string>) {
    try {
      setKeybindingsError(null)
      await state.socket.command({
        type: "settings.writeKeybindings",
        bindings: buildKeybindingPayload(drafts),
      })
    } catch (error) {
      setKeybindingsError(error instanceof Error ? error.message : "Unable to save keybindings.")
    }
  }

  async function commitKeybindings() {
    await writeKeybindings(keybindingDrafts)
  }

  async function restoreDefaultKeybinding(action: KeybindingAction) {
    const nextDrafts = {
      ...keybindingDrafts,
      [action]: formatKeybindingInput(DEFAULT_KEYBINDINGS[action]),
    }
    setKeybindingDrafts(nextDrafts)
    await writeKeybindings(nextDrafts)
  }

  return (
    <div className="border-b border-border">
      {keybindingsError ? (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {keybindingsError}
        </div>
      ) : null}
      {resolvedKeybindings.warning ? (
        <div className="mb-4 rounded-lg border border-border bg-card/30 px-4 py-3 text-sm text-muted-foreground">
          {resolvedKeybindings.warning}
        </div>
      ) : null}
      {KEYBINDING_ACTIONS.map((action, index) => (
        <KeybindingRow
          key={action}
          action={action}
          currentValue={keybindingDrafts[action] ?? ""}
          bordered={index !== 0}
          onDraftChange={setKeybindingDraft}
          onCommit={commitKeybindings}
          onRestoreDefault={restoreDefaultKeybinding}
        />
      ))}
    </div>
  )
}
