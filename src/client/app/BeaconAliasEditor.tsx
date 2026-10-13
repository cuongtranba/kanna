import { useCallback, type ChangeEvent } from "react"
import { Pencil } from "lucide-react"
import { Button } from "../components/ui/button"
import { Input } from "../components/ui/input"
import { HoverHint } from "../components/ui/truncated-text"
import { beaconDraftKey, useBeaconsSectionStore } from "../stores/beaconsSectionStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { validateBeaconAliasFormat } from "../../shared/beacon-alias"
import { errorMessage } from "../../shared/errors"

export function BeaconAliasEditButton({
  beaconId,
  alias,
  displayName,
}: {
  beaconId: string
  alias: string | null
  displayName: string
}) {
  const beginAliasEdit = useBeaconsSectionStore((s) => s.beginAliasEdit)

  const onClick = useCallback(() => {
    beginAliasEdit(beaconId, alias ?? "")
  }, [alias, beaconId, beginAliasEdit])

  return (
    <HoverHint label="Set a short name">
      <Button variant="ghost" size="icon-sm" onClick={onClick} aria-label={`Set a short name for ${displayName}`}>
        <Pencil className="h-3.5 w-3.5" />
      </Button>
    </HoverHint>
  )
}

export function BeaconAliasForm({
  beaconId,
  alias,
  displayName,
  onSetAlias,
}: {
  beaconId: string
  alias: string | null
  displayName: string
  onSetAlias: (id: string, alias: string | null) => Promise<void>
}) {
  const draftKey = beaconDraftKey(beaconId, "alias")
  const draft = useBeaconsSectionStore((s) => s.drafts[draftKey])
  const serverError = useBeaconsSectionStore((s) => s.aliasErrors[beaconId] ?? null)
  const setDraft = useBeaconsSectionStore((s) => s.setDraft)
  const setAliasError = useBeaconsSectionStore((s) => s.setAliasError)
  const endAliasEdit = useBeaconsSectionStore((s) => s.endAliasEdit)
  const saveKey = pendingActionKey("beacons.setAlias", beaconId)
  const saving = usePendingAction(saveKey)
  const value = draft ?? ""
  const formatError = value.length === 0 ? null : validateBeaconAliasFormat(value)
  const canSave = value.length > 0 && formatError === null && value !== alias
  const shownError = formatError ?? serverError

  const onChange = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    setDraft(draftKey, event.target.value.toLowerCase())
    setAliasError(beaconId, null)
  }, [beaconId, draftKey, setAliasError, setDraft])

  const submit = useCallback((next: string | null) => {
    runPendingAction(saveKey, async () => {
      try {
        await onSetAlias(beaconId, next)
        endAliasEdit(beaconId)
      } catch (error) {
        setAliasError(beaconId, errorMessage(error))
      }
    })
  }, [beaconId, endAliasEdit, onSetAlias, saveKey, setAliasError])

  const onSave = useCallback(() => {
    submit(value)
  }, [submit, value])

  const onClear = useCallback(() => {
    submit(null)
  }, [submit])

  const onCancel = useCallback(() => {
    endAliasEdit(beaconId)
  }, [beaconId, endAliasEdit])

  if (draft === undefined) return null

  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={value}
          onChange={onChange}
          placeholder="office-mac"
          disabled={saving}
          aria-label={`Short name for ${displayName}`}
          aria-invalid={shownError !== null || undefined}
          className="w-48"
        />
        <Button size="sm" onClick={onSave} pending={saving} disabled={!canSave}>
          Save
        </Button>
        <Button variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
          Cancel
        </Button>
        {alias !== null && (
          <Button variant="ghost" size="sm" onClick={onClear} disabled={saving}>
            Clear alias
          </Button>
        )}
      </div>
      <p className="text-xs text-muted-foreground">
        Type <span className="font-mono">@beacon/{value.length > 0 ? value : "name"}</span> in a message to refer to this machine.
      </p>
      {shownError !== null && (
        <p role="alert" className="text-xs text-destructive-text">
          {shownError}
        </p>
      )}
    </div>
  )
}
