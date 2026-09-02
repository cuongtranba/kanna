import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { PluginKindSection } from "./PluginsSection"
import type { InstalledPackage, PackageUpdateEntry } from "../../../shared/packages/types"

const noop = () => undefined

function makePackage(overrides: Partial<InstalledPackage> = {}): InstalledPackage {
  return {
    id: "claude-plugin:my-plugin",
    kind: "claude-plugin",
    name: "my-plugin",
    source: "acme",
    sourceUrl: "https://example.com/my-plugin",
    version: "1.2.3",
    revision: "abcdef1234567890",
    installedAt: null,
    updatedAt: null,
    installPath: null,
    versionLabel: null,
    agents: [],
    ...overrides,
  }
}

function makeUpdateEntry(overrides: Partial<PackageUpdateEntry> = {}): PackageUpdateEntry {
  return {
    ...makePackage(),
    update: {
      id: "claude-plugin:my-plugin",
      availability: "up_to_date",
      currentRevision: "abcdef1234567890",
      latestRevision: "abcdef1234567890",
      currentVersion: "1.2.3",
      latestVersion: "1.2.3",
      checkedAt: 0,
      error: null,
    },
    ...overrides,
  }
}

const baseProps = {
  label: "Claude Code",
  kind: "claude-plugin" as const,
  packages: [] as InstalledPackage[],
  errors: [] as Array<{ kind: "claude-plugin" | "codex-plugin" | "skill"; message: string }>,
  updateEntries: [] as PackageUpdateEntry[],
  applying: [] as string[],
  isChecking: false,
  onCheckUpdates: noop,
  onUpdate: noop,
}

describe("PluginKindSection", () => {
  test("shows empty state when no packages installed", () => {
    const html = renderToStaticMarkup(<PluginKindSection {...baseProps} />)
    expect(html).toContain("No Claude Code plugins installed")
  })

  test("shows CLI-missing message for claude-plugin kind", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        errors={[{ kind: "claude-plugin", message: "claude not found" }]}
      />
    )
    expect(html).toContain("Claude Code CLI not found")
    expect(html).not.toContain("No Claude Code plugins installed")
  })

  test("shows CLI-missing message for codex-plugin kind", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        label="Codex"
        kind="codex-plugin"
        errors={[{ kind: "codex-plugin", message: "codex not found" }]}
      />
    )
    expect(html).toContain("Codex CLI not found")
  })

  test("renders installed plugin with name", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection {...baseProps} packages={[makePackage()]} />
    )
    expect(html).toContain("my-plugin")
    expect(html).toContain("acme")
  })

  test("shows versionLabel when available", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage({ versionLabel: "v1.0.0" })]}
      />
    )
    expect(html).toContain("v1.0.0")
    expect(html).not.toContain("1.2.3")
  })

  test("falls back to version string when no versionLabel", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection {...baseProps} packages={[makePackage({ versionLabel: null })]} />
    )
    expect(html).toContain("1.2.3")
  })

  test("falls back to revision hash (7 chars) when no version or versionLabel", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage({ versionLabel: null, version: null })]}
      />
    )
    expect(html).toContain("abcdef1")
    expect(html).not.toContain("abcdef1234567890")
  })

  test("shows Outdated pill and Update button when outdated", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage()]}
        updateEntries={[makeUpdateEntry({ update: { id: "claude-plugin:my-plugin", availability: "outdated", currentRevision: "abc", latestRevision: "def", currentVersion: "1.0.0", latestVersion: "2.0.0", checkedAt: 0, error: null } })]}
      />
    )
    expect(html).toContain("Outdated")
    expect(html).toContain("Update")
  })

  test("shows Partial pill and Update button when partial", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage()]}
        updateEntries={[makeUpdateEntry({ update: { id: "claude-plugin:my-plugin", availability: "partial", currentRevision: "abc", latestRevision: "def", currentVersion: null, latestVersion: null, checkedAt: 0, error: null } })]}
      />
    )
    expect(html).toContain("Partial")
    expect(html).toContain("Update")
  })

  test("shows Unknown pill but no Update button", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage()]}
        updateEntries={[makeUpdateEntry({ update: { id: "claude-plugin:my-plugin", availability: "unknown", currentRevision: null, latestRevision: null, currentVersion: null, latestVersion: null, checkedAt: 0, error: "check failed" } })]}
      />
    )
    expect(html).toContain("Unknown")
    expect(html).not.toContain(">Update<")
  })

  test("hides pill when up_to_date", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[makePackage()]}
        updateEntries={[makeUpdateEntry()]}
      />
    )
    expect(html).not.toContain("Up to date")
    expect(html).not.toContain(">Update<")
  })

  test("renders external link when sourceUrl is present", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection {...baseProps} packages={[makePackage()]} />
    )
    expect(html).toContain("https://example.com/my-plugin")
  })

  test("skips external link when sourceUrl is null", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection {...baseProps} packages={[makePackage({ sourceUrl: null })]} />
    )
    expect(html).not.toContain("example.com")
  })

  test("groups packages by source into separate marketplace headers", () => {
    const html = renderToStaticMarkup(
      <PluginKindSection
        {...baseProps}
        packages={[
          makePackage({ id: "claude-plugin:a", name: "a", source: "acme" }),
          makePackage({ id: "claude-plugin:b", name: "b", source: "beta-shop" }),
        ]}
      />
    )
    expect(html).toContain("acme")
    expect(html).toContain("beta-shop")
    expect(html).toContain("a")
    expect(html).toContain("b")
  })
})
