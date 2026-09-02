import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { InstalledSkillCard } from "./SkillCard"
import type { InstalledSkillSummary } from "../../../shared/types"
import type { PackageUpdateEntry } from "../../../shared/packages/types"

const SKILL: InstalledSkillSummary = {
  name: "my-skill",
  source: "acme",
  sourceType: "registry",
  sourceUrl: "https://skills.sh/acme/my-skill",
  installedAt: "2026-01-01T00:00:00Z",
  updatedAt: "2026-01-02T00:00:00Z",
}

function makeEntry(overrides: Partial<PackageUpdateEntry> = {}): PackageUpdateEntry {
  return {
    id: "skill:my-skill",
    kind: "skill",
    name: "my-skill",
    source: "acme",
    sourceUrl: null,
    version: null,
    revision: "abcdef1234567890",
    installedAt: null,
    updatedAt: null,
    installPath: null,
    versionLabel: null,
    agents: [],
    update: {
      id: "skill:my-skill",
      availability: "up_to_date",
      currentRevision: "abcdef1234567890",
      latestRevision: "abcdef1234567890",
      currentVersion: null,
      latestVersion: null,
      checkedAt: Date.now(),
      error: null,
    },
    ...overrides,
  }
}

const noop = () => undefined

describe("InstalledSkillCard", () => {
  test("renders name and source", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={null} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("my-skill")
    expect(html).toContain("acme")
  })

  test("shows revision hash truncated to 7 chars when no versionLabel", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry()} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("abcdef1")
    expect(html).not.toContain("abcdef1234567890")
  })

  test("prefers versionLabel over revision", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry({ versionLabel: "v1.2.3" })} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("v1.2.3")
    expect(html).not.toContain("abcdef1")
  })

  test("shows outdated pill and Update button", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry({ update: { ...makeEntry().update, availability: "outdated" } })} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("Outdated")
    expect(html).toContain("Update")
  })

  test("shows partial pill and Update button", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry({ update: { ...makeEntry().update, availability: "partial" } })} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("Partial")
    expect(html).toContain("Update")
  })

  test("shows unknown pill but no Update button", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry({ update: { ...makeEntry().update, availability: "unknown" } })} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).toContain("Unknown")
    expect(html).not.toContain(">Update<")
  })

  test("hides pill when up_to_date", () => {
    const html = renderToStaticMarkup(
      <InstalledSkillCard skill={SKILL} packageEntry={makeEntry()} uninstalling={false} applying={false} onUninstall={noop} onUpdate={noop} />
    )
    expect(html).not.toContain("Up to date")
    expect(html).not.toContain(">Update<")
  })
})
