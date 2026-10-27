import { useEffect } from "react"
import { CLOUDFLARE_TUNNEL_DEFAULTS, type CloudflareTunnelMode, type CloudflareTunnelSettings } from "../../shared/types"
import { errorMessage } from "../../shared/errors"
import { SettingsRow } from "../components/settings/SettingsList"
import { Input } from "../components/ui/input"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import { pendingActionKey, runPendingAction, usePendingAction } from "../stores/pendingActionsStore"
import { PendingSegmentedControl } from "./PendingSegmentedControl"
import type { KannaState } from "./useKannaState"

const cloudflareTunnelEnabledOptions = [
  { value: "disabled" as const, label: "Off" },
  { value: "enabled" as const, label: "On" },
]

const cloudflareTunnelModeOptions: { value: CloudflareTunnelMode; label: string }[] = [
  { value: "always-ask", label: "Always ask" },
  { value: "auto-expose", label: "Auto-expose" },
]

const TUNNEL_WRITE_SCOPE = "appSettings.setCloudflareTunnel"
const CLOUDFLARED_PATH_KEY = pendingActionKey(TUNNEL_WRITE_SCOPE, "cloudflaredPath")

export function GeneralTunnelRows({ state }: { state: Pick<KannaState, "handleWriteCloudflareTunnel"> }) {
  const appSettings = useAppSettingsStore((s) => s.settings)
  const tunnelError = useGeneralSettingsStore((s) => s.tunnelError)
  const setTunnelError = useGeneralSettingsStore((s) => s.setTunnelError)
  const cloudflaredPathDraft = useGeneralSettingsStore((s) => s.drafts.cloudflaredPath)
  const patchDrafts = useGeneralSettingsStore((s) => s.patchDrafts)
  const cloudflaredPathSaving = usePendingAction(CLOUDFLARED_PATH_KEY)
  const tunnelSettings: CloudflareTunnelSettings = appSettings?.cloudflareTunnel ?? CLOUDFLARE_TUNNEL_DEFAULTS
  const tunnelEnabledValue = tunnelSettings.enabled ? "enabled" : "disabled"
  const persistedCloudflaredPath = appSettings?.cloudflareTunnel.cloudflaredPath

  useEffect(() => {
    if (persistedCloudflaredPath === undefined) return
    patchDrafts({ cloudflaredPath: persistedCloudflaredPath })
  }, [persistedCloudflaredPath, patchDrafts])

  async function handleTunnelPatch(patch: Partial<CloudflareTunnelSettings>) {
    try {
      setTunnelError(null)
      await state.handleWriteCloudflareTunnel(patch)
    } catch (error) {
      setTunnelError(errorMessage(error))
    }
  }

  return (
    <div className="border-b border-border">
      {tunnelError ? (
        <div className="mb-4 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {tunnelError}
        </div>
      ) : null}
      <SettingsRow
        title="Cloudflare Tunnel"
        description={(
          <>
            <span>
              When enabled, Claude can call the <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">expose_port</code> tool to expose a local port via Cloudflare Tunnel. The mode below controls whether each call requires your approval or is exposed automatically. Requires{" "}
              <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">cloudflared</code>{" "}
              to be installed.
            </span>
            <span className="mt-1 block">
              Stored in {appSettings?.filePathDisplay ?? "~/.kanna/data/settings.json"}.
            </span>
          </>
        )}
        bordered={false}
      >
        <PendingSegmentedControl
          pendingKey={pendingActionKey(TUNNEL_WRITE_SCOPE, "enabled")}
          value={tunnelEnabledValue}
          onValueChange={(value) => handleTunnelPatch({ enabled: value === "enabled" })}
          options={cloudflareTunnelEnabledOptions}
          size="sm"
        />
      </SettingsRow>
      {tunnelSettings.enabled && (
        <>
          <SettingsRow
            title="Tool mode"
            description="Always ask: each expose_port call shows an accept card. Auto-expose: expose_port calls spawn cloudflared immediately without prompting."
          >
            <PendingSegmentedControl
              pendingKey={pendingActionKey(TUNNEL_WRITE_SCOPE, "mode")}
              value={tunnelSettings.mode}
              onValueChange={(value) => handleTunnelPatch({ mode: value })}
              options={cloudflareTunnelModeOptions}
              size="sm"
            />
          </SettingsRow>
          <SettingsRow
            title="cloudflared path"
            description="Path to the cloudflared binary. Defaults to the one found on $PATH."
          >
            <Input
              value={cloudflaredPathDraft}
              onChange={(event) => patchDrafts({ cloudflaredPath: event.target.value })}
              onBlur={() => runPendingAction(CLOUDFLARED_PATH_KEY, () => handleTunnelPatch({ cloudflaredPath: cloudflaredPathDraft }))}
              readOnly={cloudflaredPathSaving}
              aria-busy={cloudflaredPathSaving || undefined}
              placeholder="cloudflared"
              className="w-full font-mono md:w-64"
            />
          </SettingsRow>
        </>
      )}
    </div>
  )
}
