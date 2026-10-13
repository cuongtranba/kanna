import { BEACON_MENTION_PREFIX, buildBeaconMentionIndex, resolveBeaconMentions } from "../shared/beacon-alias"
import type { BeaconConfig } from "../shared/beacon-config"

export function renderBeaconMentionBlock(
  content: string,
  beacons: readonly BeaconConfig[],
  isOnline: (beaconId: string) => boolean,
): string | null {
  const { beacons: mentioned } = resolveBeaconMentions(content, beacons)
  if (mentioned.length === 0) return null
  const { handleByBeaconId } = buildBeaconMentionIndex(beacons)
  const lines = mentioned.map((beacon) => {
    const handle = handleByBeaconId.get(beacon.id) ?? beacon.id
    const presence = isOnline(beacon.id) ? "online" : "offline"
    const enablement = beacon.enabled ? "enabled" : "disabled"
    return `- @${BEACON_MENTION_PREFIX}${handle} → beaconId ${beacon.id} (hostname ${beacon.label}, ${beacon.os}, ${presence}, ${enablement})`
  })
  return [
    "Mentioned beacons:",
    ...lines,
    "Use this beaconId with the mcp__kanna__beacon_* tools.",
  ].join("\n")
}

export function withBeaconMentions(
  prompt: string,
  typedContent: string,
  beacons: readonly BeaconConfig[],
  isOnline: (beaconId: string) => boolean,
): string {
  const block = renderBeaconMentionBlock(typedContent, beacons, isOnline)
  return block === null ? prompt : `${prompt}\n\n${block}`
}
