import { describe, expect, test } from "bun:test"
import { mkdtempSync, symlinkSync, mkdirSync, realpathSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { generateBwrapArgs } from "./profile-linux.adapter"

// Resolve a path the same way generateBwrapArgs does (symlink-aware, with
// walk-up fallback for non-existent paths). On macOS test machines /etc is
// a symlink to /private/etc, so literal expectations must be resolved.
function r(p: string): string {
  try {
    return realpathSync(p)
  } catch {
    try {
      return path.join(realpathSync(path.dirname(p)), path.basename(p))
    } catch {
      return p
    }
  }
}

const POLICY = {
  defaultAction: "ask" as const,
  bash: { autoAllowVerbs: [] },
  readPathDeny: ["~/.ssh", "/etc/shadow"],
  writePathDeny: ["/etc/**"],
  toolDenyList: [],
  toolAllowList: [],
}

function tmpfsTargets(argv: string[]): string[] {
  const out: string[] = []
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--tmpfs") out.push(argv[i + 1])
  }
  return out
}

describe("generateBwrapArgs", () => {
  test("emits base --bind / / and --die-with-parent", () => {
    const { argv } = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    expect(argv).toContain("--bind")
    expect(argv).toContain("--die-with-parent")
  })

  test("emits --tmpfs for each non-glob deny entry (tilde expanded, symlink-resolved)", () => {
    const { argv } = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    const targets = tmpfsTargets(argv)
    expect(targets).toContain(r("/home/u/.ssh"))
    expect(targets).toContain(r("/etc/shadow"))
  })

  test("strips /** suffix to the directory path", () => {
    const { argv } = generateBwrapArgs({ policy: POLICY, homeDir: "/home/u" })
    expect(tmpfsTargets(argv)).toContain(r("/etc"))
  })

  test("glob patterns surface in unmountableGlobs, never as a --tmpfs arg", () => {
    const { argv, unmountableGlobs } = generateBwrapArgs({
      policy: { ...POLICY, readPathDeny: ["**/.env", "**/*.pem", "~/.ssh"] },
      homeDir: "/home/u",
    })
    expect(unmountableGlobs).toContain("**/.env")
    expect(unmountableGlobs).toContain("**/*.pem")
    expect(tmpfsTargets(argv)).toContain(r("/home/u/.ssh"))
    expect(tmpfsTargets(argv).some((t) => t.includes("*"))).toBe(false)
  })

  test("resolves a symlinked homeDir to its real target (no symlink bypass)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kanna-bwrap-sym-"))
    const realHome = path.join(root, "real-home")
    mkdirSync(path.join(realHome, ".ssh"), { recursive: true })
    const linkHome = path.join(root, "link-home")
    symlinkSync(realHome, linkHome)

    const { argv } = generateBwrapArgs({
      policy: { ...POLICY, readPathDeny: ["~/.ssh"], writePathDeny: [] },
      homeDir: linkHome,
    })
    const targets = tmpfsTargets(argv)
    expect(targets).toContain(path.join(realpathSync(realHome), ".ssh"))
    expect(targets).not.toContain(path.join(linkHome, ".ssh"))
  })

  test("non-existent deny path falls back to walk-up real prefix (never throws)", () => {
    const root = mkdtempSync(path.join(tmpdir(), "kanna-bwrap-ne-"))
    const { argv } = generateBwrapArgs({
      policy: { ...POLICY, readPathDeny: [path.join(root, "nope", "creds")], writePathDeny: [] },
      homeDir: root,
    })
    expect(tmpfsTargets(argv).length).toBeGreaterThanOrEqual(1)
  })
})
