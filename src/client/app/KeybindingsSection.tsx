import { useEffect, useMemo } from "react"
import { DEFAULT_KEYBINDINGS, KEYBINDING_ACTIONS } from "../../shared/app-settings-types"
import type { KeybindingAction } from "../../shared/app-settings-types"
import { Input } from "../components/ui/input"
import { SettingsRow } from "../components/settings/SettingsList"
import {
  KEYBINDING_ACTION_LABELS,
  formatKeybindingInput,
  getResolvedKeybindings,
  parseKeybindingInput,
} from "../lib/keybindings"
import { handleTextInputKeyDown } from "../lib/settings-input"
import { useSettingsPageStore } from "../stores/settingsPageStore"
import type { KannaState } from "./useKannaState"

function buildKeybindingPayload(source: Record<string, string>): Record<KeybindingAction, string[]> {
  const drafted: Partial<Record<KeybindingAction, string[]>> = {}
  for (const action of KEYBINDING_ACTIONS) {
    drafted[action] = parseKeybindingInput(source[action] ?? "")
  }
  return { ...DEFAULT_KEYBINDINGS, ...drafted }
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
      {KEYBINDING_ACTIONS.map((action, index) => {
        const defaultValue = formatKeybindingInput(DEFAULT_KEYBINDINGS[action])
        const currentValue = keybindingDrafts[action] ?? ""
        const showRestore = currentValue !== defaultValue

        return (
          <SettingsRow
            key={action}
            title={KEYBINDING_ACTION_LABELS[action]}
            description={(
              <>
                <span>Comma-separated shortcuts.</span>
                {showRestore ? (
                  <>
                    <span> </span>
                    <button
                      type="button"
                      onClick={() => {
                        void restoreDefaultKeybinding(action)
                      }}
                      className="inline rounded text-foreground hover:text-foreground/80"
                    >
                      Restore: {defaultValue}
                    </button>
                  </>
                ) : null}
              </>
            )}
            bordered={index !== 0}
          >
            <div className="flex min-w-0 max-w-[420px] flex-1 flex-col items-stretch gap-2">
              <Input
                type="text"
                value={currentValue}
                onChange={(event) => setKeybindingDraft(action, event.target.value)}
                onBlur={() => {
                  void commitKeybindings()
                }}
                onKeyDown={(event) => handleTextInputKeyDown(event, () => {
                  void commitKeybindings()
                })}
                className="font-mono"
              />
            </div>
          </SettingsRow>
        )
      })}
    </div>
  )
}
