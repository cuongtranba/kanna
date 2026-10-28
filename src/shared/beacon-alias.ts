import type { BeaconConfig } from "./beacon-config"

export const BEACON_ALIAS_MAX_LENGTH = 40

export const BEACON_ALIAS_PATTERN = new RegExp(`^[a-z0-9][a-z0-9_-]{0,${BEACON_ALIAS_MAX_LENGTH - 1}}$`)

export const BEACON_MENTION_PREFIX = "beacon/"

export const BEACON_MENTION_PATTERN = `(^|[\\s\\n\\t])@${BEACON_MENTION_PREFIX}([A-Za-z0-9][A-Za-z0-9_-]*)`

export function createBeaconMentionRegex(): RegExp {
  return new RegExp(BEACON_MENTION_PATTERN, "g")
}

export function validateBeaconAliasFormat(alias: string): string | null {
  if (alias.length === 0) return "Short name is required"
  if (alias.length > BEACON_ALIAS_MAX_LENGTH) {
    return `Short name must be at most ${BEACON_ALIAS_MAX_LENGTH} characters`
  }
  if (!BEACON_ALIAS_PATTERN.test(alias)) {
    return "Use lowercase letters, digits, - and _, starting with a letter or digit"
  }
  return null
}

export function beaconDisplayName(beacon: { alias?: string | null; label: string }): string {
  return beacon.alias ?? beacon.label
}

export interface MentionableBeacon {
  id: string
  label: string
  alias?: string | null
}

export interface BeaconMentionIndex {
  handleByBeaconId: ReadonlyMap<string, string>
  beaconIdByHandle: ReadonlyMap<string, string>
}

const INVALID_HANDLE_CHARS = /[^a-z0-9_-]+/g
const EDGE_SEPARATORS = /^[-_]+|[-_]+$/g

function slugifyLabel(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(INVALID_HANDLE_CHARS, "-")
    .replace(EDGE_SEPARATORS, "")
    .slice(0, BEACON_ALIAS_MAX_LENGTH)
    .replace(EDGE_SEPARATORS, "")
  return slug.length > 0 ? slug : "beacon"
}

function freeHandle(base: string, taken: ReadonlyMap<string, string>): string {
  if (!taken.has(base)) return base
  let suffix = 2
  while (taken.has(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

export function buildBeaconMentionIndex(beacons: readonly MentionableBeacon[]): BeaconMentionIndex {
  const ordered = [...beacons].sort((left, right) => left.id.localeCompare(right.id))
  const handleByBeaconId = new Map<string, string>()
  const beaconIdByHandle = new Map<string, string>()

  for (const beacon of ordered) {
    if (beacon.alias === undefined || beacon.alias === null) continue
    if (beaconIdByHandle.has(beacon.alias)) continue
    handleByBeaconId.set(beacon.id, beacon.alias)
    beaconIdByHandle.set(beacon.alias, beacon.id)
  }

  for (const beacon of ordered) {
    if (handleByBeaconId.has(beacon.id)) continue
    const handle = freeHandle(slugifyLabel(beacon.label), beaconIdByHandle)
    handleByBeaconId.set(beacon.id, handle)
    beaconIdByHandle.set(handle, beacon.id)
  }

  return { handleByBeaconId, beaconIdByHandle }
}

export function parseBeaconMentionHandles(text: string): string[] {
  const handles: string[] = []
  for (const match of text.matchAll(createBeaconMentionRegex())) {
    const handle = match[2]
    if (handle !== undefined) handles.push(handle.toLowerCase())
  }
  return handles
}

export interface BeaconMentionResolution {
  beacons: BeaconConfig[]
  unresolvedHandles: string[]
}

export function resolveBeaconMentions(
  text: string,
  beacons: readonly BeaconConfig[],
): BeaconMentionResolution {
  const handles = parseBeaconMentionHandles(text)
  if (handles.length === 0) return { beacons: [], unresolvedHandles: [] }
  const { beaconIdByHandle } = buildBeaconMentionIndex(beacons)
  const byId = new Map(beacons.map((beacon) => [beacon.id, beacon]))
  const resolved: BeaconConfig[] = []
  const unresolvedHandles: string[] = []
  const seen = new Set<string>()
  for (const handle of handles) {
    const id = beaconIdByHandle.get(handle)
    const beacon = id === undefined ? undefined : byId.get(id)
    if (beacon === undefined) {
      if (!unresolvedHandles.includes(handle)) unresolvedHandles.push(handle)
      continue
    }
    if (seen.has(beacon.id)) continue
    seen.add(beacon.id)
    resolved.push(beacon)
  }
  return { beacons: resolved, unresolvedHandles }
}
