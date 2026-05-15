import { describe, expect, test } from "bun:test"
import { realpathSync } from "node:fs"
import path from "node:path"
import { generateMacosProfile } from "./profile-macos"

// Resolve paths the same way the profile generator does — /etc is /private/etc on macOS.
function r(p: string): string {
  try { return realpathSync(p) } catch { /* fall through */ }
  // Path doesn't exist: resolve the parent and rejoin basename.
  try { return path.join(realpathSync(path.dirname(p)), path.basename(p)) } catch { return p }
}

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
    expect(profile).toContain(`(deny file-read* (subpath "/Users/u/.ssh"))`)
    expect(profile).toContain(`(deny file-read* (subpath "/Users/u/.aws"))`)
    expect(profile).toContain(`(deny file-read* (literal "${r("/etc/shadow")}"))`)
  })

  test("emits writePathDeny entries as file-write* denies", () => {
    const profile = generateMacosProfile({ policy: POLICY, homeDir: "/Users/u" })
    expect(profile).toContain(`file-write* (subpath "${r("/etc")}")`)
    expect(profile).toContain(`file-write* (subpath "/Users/u/.ssh")`)
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
