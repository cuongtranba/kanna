import { useEffect } from "react"
import { SHARE_DEFAULT_TTL_HOURS_BOUND } from "../../shared/settings/bounds"
import { resolveNumberCommit } from "../lib/numberDraft"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import { SettingsNumberRow } from "./SettingsNumberRow"
import type { KannaState } from "./useKannaState"
import { useAppSettingsWriter } from "./useAppSettingsWriter"

export function GeneralShareRow({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const { write } = useAppSettingsWriter(state)
  const shareDefaultTtlHours = useAppSettingsStore((s) => s.settings?.shareDefaultTtlHours ?? 24)
  const draft = useGeneralSettingsStore((s) => s.drafts.shareDefaultTtl)
  const patchDrafts = useGeneralSettingsStore((s) => s.patchDrafts)
  const setAppSettingsError = useGeneralSettingsStore((s) => s.setAppSettingsError)

  useEffect(() => {
    patchDrafts({ shareDefaultTtl: String(shareDefaultTtlHours) })
  }, [shareDefaultTtlHours, patchDrafts])

  function commit() {
    const result = resolveNumberCommit(draft, shareDefaultTtlHours, SHARE_DEFAULT_TTL_HOURS_BOUND)
    if (result.kind !== "write") {
      patchDrafts({ shareDefaultTtl: String(shareDefaultTtlHours) })
      if (result.kind === "invalid") {
        setAppSettingsError("Default share link expiry must be a whole number of hours >= 1.")
      }
      return
    }
    write({ shareDefaultTtlHours: result.value })
  }

  return (
    <div className="border-b border-border">
      <SettingsNumberRow
        title="Public share links"
        description="Default expiry for read-only chat share links. Owners can revoke any link manually at any time."
        min={SHARE_DEFAULT_TTL_HOURS_BOUND.min}
        step={1}
        value={draft}
        onValueChange={(value) => patchDrafts({ shareDefaultTtl: value })}
        onCommit={commit}
        unit="hours"
        ariaLabel="Default share link expiry in hours"
        hint="Minimum 1 hour · default 24"
        bordered={false}
      />
    </div>
  )
}
