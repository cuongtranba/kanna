import type { ReactNode } from "react"
import type { LocalProjectsSnapshot, PushConfigSnapshot } from "../../../shared/types"
import { isValidVapidSubject } from "../../../shared/vapid-subject"
import { errorMessage } from "../../../shared/errors"
import { useKannaStateStore } from "../../stores/kannaStateStore"
import { cn } from "../../lib/utils"
import { pendingActionKey, runPendingAction, usePendingAction } from "../../stores/pendingActionsStore"
import type { PushPermissionState } from "../../app/pushClient"
import { Input } from "../ui/input"
import { Spinner } from "../ui/spinner"
import { TruncatedText } from "../ui/truncated-text"

interface PushNotificationsSectionProps {
  permissionState: PushPermissionState
  config: PushConfigSnapshot
  projects: LocalProjectsSnapshot["projects"]
  currentDeviceId: string | null
  contactSubject: string
  contactSubjectDraft: string
  onContactSubjectDraftChange: (value: string) => void
  onEnable: () => Promise<void>
  onDisable: () => Promise<void>
  onTest: () => Promise<void>
  onMuteToggle: (localPath: string, muted: boolean) => Promise<void>
  onRemoveDevice: (id: string) => Promise<void>
  onContactSubjectSave: (value: string) => Promise<void>
}

const secondaryButton =
  "inline-flex items-center justify-center rounded-lg border border-border bg-background px-3 py-1.5 text-sm font-medium text-foreground transition-colors hover:bg-muted"
const primaryButton =
  "inline-flex items-center justify-center rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background transition-colors hover:bg-foreground/90"
const codeChip = "rounded bg-muted px-1 py-0.5 font-mono text-12 text-foreground"
const sectionLabel = "text-xs font-medium tracking-wide text-muted-foreground"
const pendingButton = "gap-1.5 disabled:cursor-default disabled:opacity-60"

const PUSH_ENABLE_KEY = "push.enable"
const PUSH_TEST_KEY = "push.test"
const PUSH_DISABLE_KEY = "push.disable"
const PUSH_CONTACT_KEY = "push.contactSubject"

async function reportFailure(action: () => Promise<void>): Promise<void> {
  try {
    await action()
    useKannaStateStore.getState().setCommandError(null)
  } catch (error) {
    useKannaStateStore.getState().setCommandError(errorMessage(error))
  }
}

function runPushAction(key: string, action: () => Promise<void>): void {
  runPendingAction(key, () => reportFailure(action))
}

interface PendingButtonProps {
  pendingKey: string
  onRun: () => Promise<void>
  className: string
  label?: string
  children: ReactNode
}

function PendingButton({ pendingKey, onRun, className, label, children }: PendingButtonProps) {
  const pending = usePendingAction(pendingKey)
  return (
    <button
      type="button"
      onClick={() => runPushAction(pendingKey, onRun)}
      disabled={pending}
      aria-busy={pending || undefined}
      aria-label={label}
      className={cn(className, pendingButton)}
    >
      {pending ? <Spinner /> : null}
      {children}
    </button>
  )
}

interface ProjectMuteRowProps {
  localPath: string
  muted: boolean
  onMuteToggle: PushNotificationsSectionProps["onMuteToggle"]
}

function ProjectMuteRow({ localPath, muted, onMuteToggle }: ProjectMuteRowProps) {
  const key = pendingActionKey("push.setProjectMute", localPath)
  const pending = usePendingAction(key)
  return (
    <label
      aria-busy={pending || undefined}
      className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 transition-colors hover:bg-muted/50"
    >
      <input
        type="checkbox"
        checked={!muted}
        disabled={pending}
        onChange={(e) => runPushAction(key, () => onMuteToggle(localPath, !e.target.checked))}
        className="h-4 w-4 shrink-0 rounded border-border accent-foreground"
      />
      <TruncatedText
        inline
        className="min-w-0 flex-1 font-mono text-12 text-foreground"
        tooltip={localPath}
      >
        {localPath}
      </TruncatedText>
      {pending ? <Spinner className="text-muted-foreground" /> : null}
    </label>
  )
}

export function PushNotificationsSection(props: PushNotificationsSectionProps) {
  const { permissionState } = props
  const contactSaving = usePendingAction(PUSH_CONTACT_KEY)

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
      <PendingButton pendingKey={PUSH_ENABLE_KEY} onRun={props.onEnable} className={primaryButton}>
        Enable on this device
      </PendingButton>
    )
  }

  const muted = new Set(props.config.preferences.mutedProjectPaths)

  const trimmedSubject = props.contactSubjectDraft.trim()
  const subjectValid = isValidVapidSubject(trimmedSubject)
  const subjectDirty = trimmedSubject !== props.contactSubject
  const commitSubject = () => {
    if (subjectValid && subjectDirty) runPushAction(PUSH_CONTACT_KEY, () => props.onContactSubjectSave(trimmedSubject))
  }

  return (
    <div className="flex w-full min-w-0 flex-col gap-5 md:w-[440px]">
      <div className="flex flex-wrap items-center gap-2">
        <span className="inline-flex items-center gap-2 rounded-full border border-border bg-card/40 px-3 py-1 text-xs font-medium text-foreground">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden />
          Enabled on this device
        </span>
        <PendingButton pendingKey={PUSH_TEST_KEY} onRun={props.onTest} className={secondaryButton}>
          Send test
        </PendingButton>
        <PendingButton pendingKey={PUSH_DISABLE_KEY} onRun={props.onDisable} className={secondaryButton}>
          Disable
        </PendingButton>
      </div>

      <div className="flex flex-col gap-2">
        <div className={cn(sectionLabel, "flex items-center gap-1.5")}>
          Contact for delivery
          {contactSaving ? <Spinner /> : null}
        </div>
        <Input
          type="text"
          inputMode="email"
          spellCheck={false}
          autoCapitalize="none"
          value={props.contactSubjectDraft}
          readOnly={contactSaving}
          aria-busy={contactSaving || undefined}
          onChange={(e) => props.onContactSubjectDraftChange(e.target.value)}
          onBlur={commitSubject}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault()
              commitSubject()
            }
          }}
          placeholder="mailto:you@example.com"
          aria-label="Push contact subject"
          aria-invalid={trimmedSubject !== "" && !subjectValid}
          className={cn("font-mono", trimmedSubject !== "" && !subjectValid && "border-destructive")}
        />
        {trimmedSubject !== "" && !subjectValid ? (
          <p className="text-xs text-destructive">
            Must be a <code className={codeChip}>mailto:</code> address or{" "}
            <code className={codeChip}>https:</code> URL with a routable domain (not localhost).
          </p>
        ) : (
          <p className="text-xs text-muted-foreground">
            Push services require a contact <code className={codeChip}>mailto:</code> or{" "}
            <code className={codeChip}>https:</code> URL to sign notifications. Set your own so
            delivery isn&rsquo;t rejected.
          </p>
        )}
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
                <span className="line-clamp-2 break-all text-xs leading-snug text-muted-foreground">
                  {device.userAgent}
                </span>
              </div>
              {!device.isCurrentDevice && (
                <PendingButton
                  pendingKey={pendingActionKey("push.unsubscribe", device.id)}
                  onRun={() => props.onRemoveDevice(device.id)}
                  label={`Remove ${device.label}`}
                  className="inline-flex shrink-0 items-center rounded-md border border-border bg-background px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  Remove
                </PendingButton>
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
              <ProjectMuteRow
                localPath={project.localPath}
                muted={muted.has(project.localPath)}
                onMuteToggle={props.onMuteToggle}
              />
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
