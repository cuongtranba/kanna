import { useMemo } from "react"
import { BEACON_MENTION_PREFIX, buildBeaconMentionIndex } from "../../shared/beacon-alias"
import type { BeaconConfig } from "../../shared/beacon-config"
import { selectCustomBeacons, useAppSettingsStore } from "../stores/appSettingsStore"

export interface BeaconSuggestion {
  kind: "beacon"
  beaconId: string
  handle: string
  alias: string | null
  hostname: string
}

const EMPTY_SUGGESTIONS: BeaconSuggestion[] = []

export function filterBeaconSuggestions(
  beacons: readonly BeaconConfig[],
  query: string,
): BeaconSuggestion[] {
  const { handleByBeaconId } = buildBeaconMentionIndex(beacons)
  const normalized = query.toLowerCase()
  const namespaced = normalized.startsWith(BEACON_MENTION_PREFIX)
  const listsEverything = normalized === "" || BEACON_MENTION_PREFIX.startsWith(normalized)
  const nameQuery = namespaced ? normalized.slice(BEACON_MENTION_PREFIX.length) : normalized

  const matches: BeaconSuggestion[] = []
  for (const beacon of beacons) {
    const handle = handleByBeaconId.get(beacon.id)
    if (handle === undefined) continue
    const hit = listsEverything
      || handle.includes(nameQuery)
      || (beacon.alias ?? "").includes(nameQuery)
      || beacon.label.toLowerCase().includes(nameQuery)
    if (!hit) continue
    matches.push({
      kind: "beacon",
      beaconId: beacon.id,
      handle,
      alias: beacon.alias ?? null,
      hostname: beacon.label,
    })
  }
  return matches.sort((left, right) => left.handle.localeCompare(right.handle))
}

export function useBeaconSuggestions(args: {
  query: string
  enabled: boolean
}): { items: BeaconSuggestion[] } {
  const beacons = useAppSettingsStore(selectCustomBeacons)
  return useMemo(() => {
    if (!args.enabled) return { items: EMPTY_SUGGESTIONS }
    return { items: filterBeaconSuggestions(beacons, args.query) }
  }, [args.enabled, args.query, beacons])
}
