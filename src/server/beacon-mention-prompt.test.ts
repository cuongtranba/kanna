import { describe, expect, test } from "bun:test"
import type { BeaconConfig } from "../shared/beacon-config"
import { DEFAULT_BEACON_SCOPE } from "../shared/beacon-scope"
import { withBeaconMentions } from "./beacon-mention-prompt"

const beacon: BeaconConfig = {
  id: "beacon-1",
  label: "MacBook-Pro.local",
  alias: "office-mac",
  publicKey: "pk",
  os: "darwin",
  scope: DEFAULT_BEACON_SCOPE,
  enabled: true,
  createdAt: "2026-10-13T00:00:00.000Z",
  updatedAt: "2026-10-13T00:00:00.000Z",
}

describe("withBeaconMentions", () => {
  test("a mentioned beacon is described with its id, hostname, os and presence", () => {
    const prompt = withBeaconMentions("run uname on @beacon/office-mac", "run uname on @beacon/office-mac", [beacon], () => false)
    expect(prompt).toContain(
      "- @beacon/office-mac → beaconId beacon-1 (hostname MacBook-Pro.local, darwin, offline, enabled)",
    )
  })

  test("a message that names no beacon is returned unchanged", () => {
    expect(withBeaconMentions("hello", "hello", [beacon], () => true)).toBe("hello")
  })

  test("a handle matching no beacon adds nothing", () => {
    expect(withBeaconMentions("hi @beacon/ghost", "hi @beacon/ghost", [beacon], () => true)).toBe("hi @beacon/ghost")
  })
})
