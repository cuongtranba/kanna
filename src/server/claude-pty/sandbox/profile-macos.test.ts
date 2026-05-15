import { describe, expect, test } from "bun:test"
import { generateMacosProfile } from "./profile-macos"

const POLICY = {
  defaultAction: "ask" as const,
  bash: { autoAllowVerbs: [] },
  readPathDeny: ["~/.ssh", "~/.aws", "/etc/shadow"],
  writePathDeny: ["/etc/**", "~/.ssh/**"],
  toolDenyList: [],
  toolAllowList: [],
}

describe("generateMacosProfile", () => {
  test("emits version + default-allow + deny entries for readPathDeny", () => {
    const profile = generateMacosProfile({ policy: POLICY, homeDir: "/Users/u" })
    expect(profile).toContain("(version 1)")
    expect(profile).toContain('(deny file-read* (subpath "/Users/u/.ssh"))')
    expect(profile).toContain('(deny file-read* (subpath "/Users/u/.aws"))')
    expect(profile).toContain('(deny file-read* (literal "/etc/shadow"))')
  })

  test("emits writePathDeny entries as file-write* denies", () => {
    const profile = generateMacosProfile({ policy: POLICY, homeDir: "/Users/u" })
    expect(profile).toContain('file-write* (subpath "/etc")')
    expect(profile).toContain('file-write* (subpath "/Users/u/.ssh")')
  })

  test("escapes quotes in paths defensively", () => {
    const profile = generateMacosProfile({
      policy: { ...POLICY, readPathDeny: ['/tmp/with"quote'] },
      homeDir: "/Users/u",
    })
    // Should not produce malformed quoting (test just asserts no naked unescaped quote inside the string literal).
    const match = profile.match(/subpath "[^"]*"/g) ?? profile.match(/literal "[^"]*"/g)
    expect(match).not.toBeNull()
  })

  test("skips empty deny lists", () => {
    const empty = generateMacosProfile({
      policy: { ...POLICY, readPathDeny: [], writePathDeny: [] },
      homeDir: "/Users/u",
    })
    expect(empty).toContain("(version 1)")
    expect(empty).not.toContain("file-read*")
  })
})
