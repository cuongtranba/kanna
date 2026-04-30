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

export function PushNotificationsSection(props: PushNotificationsSectionProps) {
  const { permissionState } = props

  if (permissionState === "unsupported") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>Push notifications are not supported in this browser.</p>
      </section>
    )
  }

  if (permissionState === "insecure-context") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>
          Push requires HTTPS. Run <code>kanna --share</code> or open Kanna over a tunnel,
          then enable on this device.
        </p>
      </section>
    )
  }

  if (permissionState === "denied") {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>You blocked notifications for this site. Re-enable them in your browser settings, then reload.</p>
      </section>
    )
  }

  const isSubscribed = permissionState === "granted"
    && props.config.devices.some((d) => d.id === props.currentDeviceId)

  if (!isSubscribed) {
    return (
      <section>
        <h2>Push Notifications</h2>
        <p>Get a notification when a chat is waiting for you, finishes, or fails.</p>
        <button type="button" onClick={() => void props.onEnable()}>Enable on this device</button>
      </section>
    )
  }

  const muted = new Set(props.config.preferences.mutedProjectPaths)

  return (
    <section>
      <h2>Push Notifications</h2>
      <div>● Enabled on this device</div>
      <div>
        <button type="button" onClick={() => void props.onTest()}>Send test</button>
        <button type="button" onClick={() => void props.onDisable()}>Disable</button>
      </div>

      <h3>Devices</h3>
      <ul>
        {props.config.devices.map((device) => (
          <li key={device.id}>
            <span>{device.label}</span>
            <span> — {device.userAgent}</span>
            {!device.isCurrentDevice && (
              <button type="button" onClick={() => void props.onRemoveDevice(device.id)}>×</button>
            )}
          </li>
        ))}
      </ul>

      <h3>Per-project</h3>
      <ul>
        {props.projects.map((project) => (
          <li key={project.localPath}>
            <label>
              <input
                type="checkbox"
                checked={!muted.has(project.localPath)}
                onChange={(e) => void props.onMuteToggle(project.localPath, !e.target.checked)}
              />
              {project.localPath}
            </label>
          </li>
        ))}
      </ul>

      <p>
        Phone setup: this page must be reachable over HTTPS. Run <code>kanna --share</code>
        or open Kanna over your tunnel on the phone, then enable on that device.
      </p>
    </section>
  )
}
