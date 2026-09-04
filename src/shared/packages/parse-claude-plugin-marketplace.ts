import { isJsonObject, type JsonValue } from "../json"

// ─── known_marketplaces.json ─────────────────────────────────────────────────

export interface MarketplaceEntry {
  name: string
  installLocation: string
  lastUpdated: string | null
}

/**
 * Parse `~/.claude/plugins/known_marketplaces.json`.
 * Returns a map from marketplace name to entry.
 */
export function parseKnownMarketplaces(raw: JsonValue): Map<string, MarketplaceEntry> {
  const result = new Map<string, MarketplaceEntry>()
  if (!isJsonObject(raw)) return result

  for (const [name, value] of Object.entries(raw)) {
    if (!name || !isJsonObject(value)) continue
    const installLocation = typeof value.installLocation === "string" ? value.installLocation : null
    if (!installLocation) continue
    result.set(name, {
      name,
      installLocation,
      lastUpdated: typeof value.lastUpdated === "string" ? value.lastUpdated : null,
    })
  }

  return result
}

// ─── Marketplace manifest (plugins.json) ─────────────────────────────────────

export interface MarketplacePluginEntry {
  version: string | null
  sha: string | null
}

/**
 * Parse a marketplace's `plugins.json` manifest.
 *
 * Expected format:
 * ```json
 * {
 *   "plugin-name": { "version": "1.0.0", "sha": "abc123..." }
 * }
 * ```
 *
 * Returns a map from plugin name to offered version info.
 * Unknown or missing fields are stored as null.
 */
export function parseMarketplaceManifest(raw: JsonValue): Map<string, MarketplacePluginEntry> {
  const result = new Map<string, MarketplacePluginEntry>()
  if (!isJsonObject(raw)) return result

  for (const [name, value] of Object.entries(raw)) {
    if (!name) continue
    if (!isJsonObject(value)) continue

    const version = typeof value.version === "string" && value.version ? value.version : null
    const sha = typeof value.sha === "string" && value.sha ? value.sha : null

    result.set(name, { version, sha })
  }

  return result
}

// ─── Classifier (pure) ───────────────────────────────────────────────────────

export type ClaudePluginAvailability = "up_to_date" | "outdated" | "unknown"

export interface ClaudePluginClassification {
  availability: ClaudePluginAvailability
  /** Latest SHA from `git log -1 -- <pluginDir>/` in the marketplace clone. */
  latestRevision: string | null
  /** Always null for git-SHA-based checks (no separate version source). */
  latestVersion: string | null
  error: string | null
}

/**
 * Classify a Claude plugin's update status by comparing installed `gitCommitSha`
 * against the latest commit SHA touching the plugin's subdirectory in the
 * marketplace clone.
 *
 * Rules:
 * - `unknown` when `latestSha` is null (fetch failed or marketplace missing)
 * - `unknown` when `installedSha` is null (no sha recorded at install time)
 * - `up_to_date` when `installedSha === latestSha`
 * - `outdated` when they differ
 */
export function classifyClaudePluginUpdate(
  installedSha: string | null,
  latestSha: string | null,
): ClaudePluginClassification {
  if (!latestSha) {
    return {
      availability: "unknown",
      latestRevision: null,
      latestVersion: null,
      error: "could not determine latest commit sha from marketplace",
    }
  }

  if (!installedSha) {
    return {
      availability: "unknown",
      latestRevision: latestSha,
      latestVersion: null,
      error: "no gitCommitSha recorded for installed plugin",
    }
  }

  if (installedSha === latestSha) {
    return {
      availability: "up_to_date",
      latestRevision: latestSha,
      latestVersion: null,
      error: null,
    }
  }

  return {
    availability: "outdated",
    latestRevision: latestSha,
    latestVersion: null,
    error: null,
  }
}
