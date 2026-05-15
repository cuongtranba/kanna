import { describe, expect, test } from "bun:test"
import { generateBwrapArgs } from "./profile-linux"

const POLICY = {
  defaultAction: "ask" as const,
  bash: { autoAllowVerbs: [] },
  readPathDeny: ["~/.ssh", "/etc/shadow"],
  writePathDeny: ["/etc/**"],
  toolDenyList: [],
  toolAllowList: [],
}

describe("generateBwrapArgs", () => {
  test("emits base --bind / / and --die-with-parent", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    expect(args).toContain("--bind")
    expect(args).toContain("--die-with-parent")
  })

  test("emits --tmpfs for each readPathDeny entry (expanded)", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    const homePos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/home/u/.ssh")
    expect(homePos).toBeGreaterThanOrEqual(0)
    const etcPos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/etc/shadow")
    expect(etcPos).toBeGreaterThanOrEqual(0)
  })

  test("emits --tmpfs for writePathDeny (strips /** suffix)", () => {
    const args = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    const pos = args.findIndex((a, i) => a === "--tmpfs" && args[i + 1] === "/etc")
    expect(pos).toBeGreaterThanOrEqual(0)
  })

  test("skips entries containing wildcards (no glob support in bwrap argv)", () => {
    const args = generateBwrapArgs({
      policy: { ...POLICY, readPathDeny: ["**/.env"] },
      homeDir: "/home/u",
    })
    // Wildcard entries are silently skipped (not translated). bwrap argv doesn't glob.
    expect(args.find((a, i) => a === "--tmpfs" && args[i + 1]?.includes("*"))).toBeUndefined()
  })
})
