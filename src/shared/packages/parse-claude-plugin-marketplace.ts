import { isJsonObject, type JsonValue } from "../json"


export interface MarketplaceEntry {
  name: string
  installLocation: string
  lastUpdated: string | null
}

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


export interface MarketplacePluginEntry {
  version: string | null
  sha: string | null
}

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


export type ClaudePluginAvailability = "up_to_date" | "outdated" | "unknown"

export interface ClaudePluginClassification {
  availability: ClaudePluginAvailability
  latestRevision: string | null
  latestVersion: string | null
  error: string | null
}

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
