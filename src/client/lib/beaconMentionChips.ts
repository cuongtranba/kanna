import { buildBeaconMentionIndex, resolveBeaconMentions } from "../../shared/beacon-alias"
import type { BeaconConfig } from "../../shared/beacon-config"

export type BeaconMentionChip =
  | { kind: "ok"; label: string; id: string }
  | { kind: "missing"; label: string }

export function beaconMentionChips(text: string, beacons: readonly BeaconConfig[]): BeaconMentionChip[] {
  const { beacons: resolved, unresolvedHandles } = resolveBeaconMentions(text, beacons)
  const { handleByBeaconId } = buildBeaconMentionIndex(beacons)
  return [
    ...resolved.map((beacon): BeaconMentionChip => ({
      kind: "ok",
      label: handleByBeaconId.get(beacon.id) ?? beacon.id,
      id: beacon.id,
    })),
    ...unresolvedHandles.map((handle): BeaconMentionChip => ({ kind: "missing", label: handle })),
  ]
}
