import type { LocalProjectsSnapshot, PushConfigSnapshot } from "../../../shared/types"
import type { PushPermissionState } from "../../app/pushClient"

interface PushNotificationsSectionProps {
  permissionState: PushPermissionState
  config: PushConfigSnapshot
  projects: LocalProjectsSnapshot["projects"]
  currentDeviceId: string | null
  onEnable: () => Promise<void>
  onDisable: () => Promise<void>
  onTest: () => Promise<void>
  onMuteToggle: (localPath: string, muted: boolean) => Promise<void>
  onRemoveDevice: (id: string) => Promise<void>
}

const secondaryButton =
  "inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
const primaryButton =
  "inline-flex items-center justify-center rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
const codeChip = "rounded bg-muted px-1 py-0.5 font-mono text-[12px] text-foreground"
const sectionLabel = "text-[11px] font-medium uppercase tracking-wide text-muted-foreground"

export function PushNotificationsSection(props: PushNotificationsSectionProps) {
  const { permissionState } = props

  if (permissionState === "unsupported") {
    return (
      <p className="text-sm text-muted-foreground">
        Push notifications are not supported in this browser.
      </p>
    )
  }

  if (permissionState === "insecure-context") {
    return (
      <p className="text-sm text-muted-foreground">
        Push requires HTTPS. Run <code className={codeChip}>kanna --share</code> or open Kanna over a tunnel,
        then enable on this device.
      </p>
    )
  }

  if (permissionState === "denied") {
    return (
      <p className="text-sm text-muted-foreground">
        You blocked notifications for this site. Re-enable them in your browser settings, then reload.
      </p>
    )
  }

  const isSubscribed =
    permissionState === "granted" &&
    props.config.devices.some((d) => d.id === props.currentDeviceId)

  if (!isSubscribed) {
    return (
      <button type="button" onClick={() => void props.onEnable()} className={primaryButton}>
        Enable on this device
      </button>
    )
  }

  const muted = new Set(props.config.preferences.mutedProjectPaths)

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 md:w-[440px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Enabled on this device
        </span>
        <button type="button" onClick={() => void props.onTest()} className={secondaryButton}>
          Send test
        </button>
        <button type="button" onClick={() => void props.onDisable()} className={secondaryButton}>
          Disable
        </button>
      </div>

      <div className="flex flex-col gap-2">
        <div className={sectionLabel}>Devices</div>
        <ul className="flex flex-col gap-1.5">
          {props.config.devices.map((device) => (
            <li
              key={device.id}
              className="flex items-start justify-between gap-3 rounded-lg border border-border bg-card/40 px-3 py-2"
            >
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate text-sm font-medium text-foreground">{device.label}</span>
                <span className="line-clamp-2 break-all text-[11px] leading-snug text-muted-foreground">
                  {device.userAgent}
                </span>
              </div>
              {!device.isCurrentDevice && (
                <button
                  type="button"
                  onClick={() => void props.onRemoveDevice(device.id)}
                  aria-label={`Remove ${device.label}`}
                  className="shrink-0 rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Remove
                </button>
              )}
            </li>
          ))}
        </ul>
      </div>

      <div className="flex flex-col gap-2">
        <div className={sectionLabel}>Per-project</div>
        <ul className="flex flex-col">
          {props.projects.map((project) => (
            <li key={project.localPath}>
              <label className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50">
                <input
                  type="checkbox"
                  checked={!muted.has(project.localPath)}
                  onChange={(e) => void props.onMuteToggle(project.localPath, !e.target.checked)}
                  className="h-4 w-4 shrink-0 rounded border-border accent-foreground"
                />
                <span
                  className="min-w-0 flex-1 truncate font-mono text-[12px] text-foreground"
                  title={project.localPath}
                >
                  {project.localPath}
                </span>
              </label>
            </li>
          ))}
        </ul>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        Phone setup: this page must be reachable over HTTPS. Run{" "}
        <code className={codeChip}>kanna --share</code> or open Kanna over your tunnel on the phone,
        then enable on that device.
      </p>
    </div>
  )
}
