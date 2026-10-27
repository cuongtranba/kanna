import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import type { DomPort } from "../ports/domPort"
import { domAdapter } from "../adapters/dom.adapter"
import { GeneralAppearanceRows } from "./GeneralAppearanceRows"
import { GeneralPrivacyRows } from "./GeneralPrivacyRows"
import { GeneralShareRow } from "./GeneralShareRow"
import { GeneralTerminalRows } from "./GeneralTerminalRows"
import { GeneralTunnelRows } from "./GeneralTunnelRows"
import type { KannaState } from "./useKannaState"

export function GeneralSettingsBranch({ state, dom = domAdapter }: { state: KannaState; dom?: DomPort }) {
  const appSettingsError = useGeneralSettingsStore((s) => s.appSettingsError)
  return (
    <>
      {appSettingsError ? (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {appSettingsError}
        </div>
      ) : null}
      <div className="border-b border-border">
        <GeneralAppearanceRows state={state} />
        <GeneralTerminalRows state={state} />
        <GeneralPrivacyRows state={state} dom={dom} />
      </div>
      <GeneralTunnelRows state={state} />
      <GeneralShareRow state={state} />
    </>
  )
}
