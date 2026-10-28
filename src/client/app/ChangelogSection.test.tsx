import { describe, expect, test } from "vite-plus/test"
import { renderToStaticMarkup } from "react-dom/server"
import { ChangelogSection } from "./ChangelogSection"
import { formatPublishedDate } from "../lib/changelog"
import type { UpdateSnapshot } from "../../shared/types"

const SAMPLE_RELEASES = [
  {
    id: 1,
    name: "v0.8.1",
    tag_name: "v0.8.1",
    html_url: "https://github.com/cuongtranba/kanna/releases/tag/v0.8.1",
    published_at: "2026-03-19T16:53:08Z",
    body: "## Improvements\n- Better cursor color",
    prerelease: false,
    draft: false,
  },
  {
    id: 2,
    name: null,
    tag_name: "v0.9.0-beta.1",
    html_url: "https://github.com/cuongtranba/kanna/releases/tag/v0.9.0-beta.1",
    published_at: "2026-03-20T12:00:00Z",
    body: "",
    prerelease: true,
    draft: false,
  },
]

function createUpdateSnapshot(overrides: Partial<UpdateSnapshot> = {}): UpdateSnapshot {
  return {
    currentVersion: "1.0.0",
    latestVersion: "1.1.0",
    status: "available",
    updateAvailable: true,
    lastCheckedAt: 123,
    error: null,
    installAction: "restart",
    reloadRequestedAt: null,
    ...overrides,
  }
}

describe("ChangelogSection", () => {
  test("renders version highlights, release cards, markdown, links, and prerelease badges", () => {
    const html = renderToStaticMarkup(
      <ChangelogSection
        status="success"
        releases={SAMPLE_RELEASES}
        error={null}
        onRetry={() => {}}
        updateSnapshot={createUpdateSnapshot({ latestVersion: "0.8.1", currentVersion: "0.8.1" })}
        currentVersion="1.0.0"
        onInstallUpdate={() => {}}
        onCheckForUpdates={async () => {}}
        onForceReload={() => {}}
      />
    )

    expect(html).not.toContain("You are currently running this version of Kanna.")
    expect(html).toContain("Current")
    expect(html).toContain("Update")
    expect(html).toContain("Update")
    expect(html).toContain("v0.8.1")
    expect(html).toContain("Better cursor color")
    expect(html).toContain('aria-label="View release on GitHub"')
    expect(html).toContain("https://github.com/cuongtranba/kanna/releases/tag/v0.8.1")
    expect(html).toContain("Prerelease")
    expect(html).toContain("No release notes were provided.")
    expect(html).toContain(formatPublishedDate("2026-03-19T16:53:08Z"))
    expect(html).not.toContain("View on GitHub")
  })

  test("renders an error state with retry action", () => {
    const html = renderToStaticMarkup(
      <ChangelogSection
        status="error"
        releases={[]}
        error="GitHub said no"
        onRetry={() => {}}
        updateSnapshot={createUpdateSnapshot({ updateAvailable: false, status: "error", error: "GitHub said no" })}
        currentVersion="1.0.0"
        onInstallUpdate={() => {}}
        onCheckForUpdates={async () => {}}
        onForceReload={() => {}}
      />
    )

    expect(html).toContain("Could not load changelog")
    expect(html).toContain("GitHub said no")
    expect(html).toContain("Retry")
  })

  test("renders check-for-updates when no update is available", () => {
    const html = renderToStaticMarkup(
      <ChangelogSection
        status="success"
        releases={SAMPLE_RELEASES}
        error={null}
        onRetry={() => {}}
        updateSnapshot={createUpdateSnapshot({
          latestVersion: "1.0.0",
          status: "up_to_date",
          updateAvailable: false,
        })}
        currentVersion="1.0.0"
        onInstallUpdate={() => {}}
        onCheckForUpdates={async () => {}}
        onForceReload={() => {}}
      />
    )

    expect(html).toContain("Check for updates")
    expect(html).not.toContain(">Update<")
  })

  test("disables the update action while updating", () => {
    const html = renderToStaticMarkup(
      <ChangelogSection
        status="success"
        releases={SAMPLE_RELEASES}
        error={null}
        onRetry={() => {}}
        updateSnapshot={createUpdateSnapshot({
          latestVersion: "0.8.1",
          status: "restart_pending",
        })}
        currentVersion="1.0.0"
        onInstallUpdate={() => {}}
        onCheckForUpdates={async () => {}}
        onForceReload={() => {}}
      />
    )

    expect(html).toContain("disabled")
    expect(html).toContain("Updating")
  })
})
