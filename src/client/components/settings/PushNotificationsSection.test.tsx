import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PushNotificationsSection } from "./PushNotificationsSection"
import type { PushConfigSnapshot, LocalProjectsSnapshot } from "../../../shared/types"

const baseConfig: PushConfigSnapshot = {
  vapidPublicKey: "key",
  preferences: { globalEnabled: true, mutedProjectPaths: [], mutedChatIds: [] },
  devices: [],
}

const baseProjects: LocalProjectsSnapshot["projects"] = [
  { localPath: "/tmp/a", title: "a", source: "saved", chatCount: 0 },
  { localPath: "/tmp/b", title: "b", source: "saved", chatCount: 0 },
]

const noopHandlers = {
  contactSubject: "mailto:kanna@example.com",
  contactSubjectDraft: "mailto:kanna@example.com",
  onContactSubjectDraftChange: () => {},
  onEnable: async () => {},
  onDisable: async () => {},
  onTest: async () => {},
  onMuteToggle: async () => {},
  onRemoveDevice: async () => {},
  onContactSubjectSave: async () => {},
}

describe("PushNotificationsSection", () => {
  test("renders the unsupported notice", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="unsupported"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/not supported/i)
  })

  test("renders the insecure-context message with --share hint", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="insecure-context"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/HTTPS/i)
    expect(html).toMatch(/--share/i)
  })

  test("renders 'Enable on this device' when permission default", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="default"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/Enable on this device/i)
  })

  test("renders denied state with re-enable prompt", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="denied"
        config={baseConfig}
        projects={baseProjects}
        currentDeviceId={null}
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/blocked notifications/i)
  })

  test("granted+subscribed shows devices and project list", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "ua", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
          preferences: { globalEnabled: true, mutedProjectPaths: ["/tmp/a"], mutedChatIds: [] },
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/iPhone/)
    expect(html).toMatch(/Send test/i)
    expect(html).toMatch(/\/tmp\/a/)
    expect(html).toMatch(/\/tmp\/b/)
  })

  test("shows the contact subject field and its helper when subscribed", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "ua", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
      />
    )
    expect(html).toMatch(/Contact for delivery/i)
    expect(html).toMatch(/require a contact/i)
  })

  test("flags an invalid contact subject draft", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "ua", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
        contactSubjectDraft="mailto:kanna@localhost"
      />
    )
    expect(html).toMatch(/routable domain/i)
    expect(html).toMatch(/aria-invalid="true"/)
  })

  test("does not render endpoint or keys for any device", () => {
    const html = renderToStaticMarkup(
      <PushNotificationsSection
        permissionState="granted"
        config={{
          ...baseConfig,
          devices: [{ id: "d1", label: "iPhone", userAgent: "https://leak.example/should/not/show", createdAt: 0, lastSeenAt: 0, isCurrentDevice: true }],
        }}
        projects={baseProjects}
        currentDeviceId="d1"
        {...noopHandlers}
      />
    )
    expect(html).not.toMatch(/p256dh/i)
    expect(html).not.toMatch(/applicationServerKey/i)
  })
})
