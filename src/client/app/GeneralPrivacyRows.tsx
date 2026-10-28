import { useEffect, useLayoutEffect } from "react"
import { ANALYTICS_STATIC_EVENT_NAMES, ANALYTICS_STATIC_PROPERTY_NAMES } from "../../shared/analytics"
import { PushNotificationsSection } from "../components/settings/PushNotificationsSection"
import { SettingsRow } from "../components/settings/SettingsList"
import { Button } from "../components/ui/button"
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogTitle } from "../components/ui/dialog"
import type { DomPort } from "../ports/domPort"
import { useAppSettingsStore } from "../stores/appSettingsStore"
import { useGeneralSettingsStore } from "../stores/generalSettingsStore"
import { usePushSettingsStore } from "../stores/pushSettingsStore"
import { PendingSegmentedControl } from "./PendingSegmentedControl"
import { surfaceErrorIn } from "../lib/commandFeedback"
import { detectPushSupport, getStoredPushDeviceId } from "./pushClient"
import { usePushDeviceActions } from "./usePushDeviceActions"
import type { KannaState } from "./useKannaState"

const analyticsOptions = [
  { value: "disabled" as const, label: "Off" },
  { value: "enabled" as const, label: "On" },
]

const DEFAULT_SETTINGS_FILE = "~/.kanna/data/settings.json"

type PrivacyRowsState = Pick<KannaState, "handleWriteAppSettings" | "pushConfig" | "localProjects" | "socket">

function PushRow({ state, dom }: { state: PrivacyRowsState; dom: DomPort }) {
  const appSettings = useAppSettingsStore((s) => s.settings)
  const permissionState = usePushSettingsStore((s) => s.permissionState)
  const deviceId = usePushSettingsStore((s) => s.deviceId)
  const contactSubjectDraft = usePushSettingsStore((s) => s.contactSubjectDraft)
  const setContactSubjectDraft = usePushSettingsStore((s) => s.setContactSubjectDraft)
  const detected = usePushSettingsStore((s) => s.detected)
  const setPermissionState = usePushSettingsStore((s) => s.setPermissionState)
  const { handleEnablePush, handleDisablePush } = usePushDeviceActions(state)
  const { pushConfig, socket } = state
  const contactSubject = appSettings?.push.contactSubject

  useLayoutEffect(() => {
    detected(detectPushSupport().state, getStoredPushDeviceId())
  }, [detected])

  useEffect(() => {
    const handler = () => setPermissionState(detectPushSupport().state)
    return dom.addWindowListener("focus", handler)
  }, [dom, setPermissionState])

  useEffect(() => {
    if (contactSubject === undefined) return
    setContactSubjectDraft(contactSubject)
  }, [contactSubject, setContactSubjectDraft])

  if (!pushConfig) return null
  return (
    <SettingsRow
      title="Push notifications"
      description="Get notified when a chat is waiting for you, finishes, or fails. Works on iPhone (after Add to Home Screen), Android, and desktop browsers."
      bordered={false}
      alignStart
    >
      <PushNotificationsSection
        permissionState={permissionState}
        config={pushConfig}
        projects={state.localProjects?.projects ?? []}
        currentDeviceId={deviceId}
        contactSubject={contactSubject ?? ""}
        contactSubjectDraft={contactSubjectDraft}
        onContactSubjectDraftChange={setContactSubjectDraft}
        onContactSubjectSave={(value) => state.handleWriteAppSettings({ push: { contactSubject: value } })}
        onEnable={handleEnablePush}
        onDisable={handleDisablePush}
        onTest={async () => {
          await socket.command({ type: "push.test" })
        }}
        onMuteToggle={async (localPath, muted) => {
          await socket.command({ type: "push.setProjectMute", localPath, muted })
        }}
        onRemoveDevice={async (id) => {
          await socket.command({ type: "push.unsubscribe", pushDeviceId: id })
        }}
      />
    </SettingsRow>
  )
}

function AnalyticsRows({ state }: { state: Pick<KannaState, "handleWriteAppSettings"> }) {
  const appSettings = useAppSettingsStore((s) => s.settings)
  const setAppSettingsError = useGeneralSettingsStore((s) => s.setAppSettingsError)
  const setAnalyticsDialogOpen = useGeneralSettingsStore((s) => s.setAnalyticsDialogOpen)
  const analyticsSettingValue = appSettings?.analyticsEnabled === false ? "disabled" : "enabled"
  const telemetrySettingValue = appSettings?.telemetry?.enabled === false ? "disabled" : "enabled"

  async function writeReportingError(patch: Parameters<KannaState["handleWriteAppSettings"]>[0]) {
    await surfaceErrorIn(setAppSettingsError, () => state.handleWriteAppSettings(patch))
  }

  return (
    <>
      <SettingsRow
        title="Anonymous Analytics"
        description={(
          <>
            <span>
              Help improve Kanna with anonymous product analytics. Kanna sends tracked event names plus a small set of event properties like current version, environment, update version info, and launch flags. No message content, prompts, file paths, or provider credentials are sent.
            </span>
            <span className="mt-1 block">
              Stored in {appSettings?.filePathDisplay ?? DEFAULT_SETTINGS_FILE}.
              {" "}
              <button
                type="button"
                onClick={() => setAnalyticsDialogOpen(true)}
                className="underline underline-offset-2 text-foreground hover:text-foreground/80"
              >
                View tracked events
              </button>
            </span>
            {appSettings?.warning ? (
              <span className="mt-1 block">{appSettings.warning}</span>
            ) : null}
          </>
        )}
      >
        <PendingSegmentedControl
          pendingKey="settings.analytics"
          value={analyticsSettingValue}
          onValueChange={(next) => writeReportingError({ analyticsEnabled: next === "enabled" })}
          options={analyticsOptions}
          size="sm"
        />
      </SettingsRow>
      <SettingsRow
        title="Telemetry Tracing"
        description={(
          <>
            <span>
              Export OpenTelemetry traces and metrics (turn timings, subagent runs, process memory) to Kanna&apos;s observability collector so each install can be monitored. This machine reports under its computer name. Turning it off stops the export immediately.
            </span>
            <span className="mt-1 block">
              Collector: {appSettings?.telemetry?.endpoint ?? "not configured"}. Stored in {appSettings?.filePathDisplay ?? DEFAULT_SETTINGS_FILE}.
            </span>
          </>
        )}
      >
        <PendingSegmentedControl
          pendingKey="settings.telemetry"
          value={telemetrySettingValue}
          onValueChange={(next) => writeReportingError({ telemetry: { enabled: next === "enabled" } })}
          options={analyticsOptions}
          size="sm"
        />
      </SettingsRow>
    </>
  )
}

function TrackedEventsDialog() {
  const open = useGeneralSettingsStore((s) => s.analyticsDialogOpen)
  const setOpen = useGeneralSettingsStore((s) => s.setAnalyticsDialogOpen)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent size="lg">
        <DialogBody className="space-y-4">
          <DialogTitle>Tracked Events</DialogTitle>
          <div className="text-sm text-muted-foreground">
            Kanna sends these event names plus the limited property keys below, depending on the event type.
          </div>
          <div className="max-h-[60vh] overflow-auto rounded-lg border border-border bg-muted/40 p-3">
            <div className="text-xs font-medium tracking-wide text-muted-foreground">
              Event Names
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {ANALYTICS_STATIC_EVENT_NAMES.map((eventName) => (
                <li key={eventName} className="font-mono text-foreground">
                  {eventName}
                </li>
              ))}
            </ul>
            <div className="mt-6 text-xs font-medium tracking-wide text-muted-foreground">
              Property Keys
            </div>
            <ul className="mt-3 space-y-2 text-sm">
              {ANALYTICS_STATIC_PROPERTY_NAMES.map((propertyName) => (
                <li key={propertyName} className="font-mono text-foreground">
                  {propertyName}
                </li>
              ))}
            </ul>
          </div>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" size="sm" onClick={() => setOpen(false)}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function GeneralPrivacyRows({ state, dom }: { state: PrivacyRowsState; dom: DomPort }) {
  return (
    <>
      <PushRow state={state} dom={dom} />
      <AnalyticsRows state={state} />
      <TrackedEventsDialog />
    </>
  )
}
