import { describe, expect, test } from "vite-plus/test"
import { McpSkillHost } from "./mcp-skill-host"
import {
  ACME_REFUNDS as ACME,
  REFUNDS_POLICY as POLICY,
  REFUNDS_SKILL_MD as REFUNDS_SKILL,
  createInProcessSkillPort,
  manualClock,
  stdioServer,
  type SkillServerSpec,
} from "./test-helpers/in-process-skill-port"
import type { McpServerConfig } from "../../shared/mcp-types"

const NONE: ReadonlySet<string> = new Set()
async function hostFor(specs: Record<string, SkillServerSpec>, servers: McpServerConfig[], clock = manualClock()) {
  const port = await createInProcessSkillPort(specs)
  const host = new McpSkillHost({ port, servers: async () => servers, clock })
  return { host, port, clock }
}

describe("McpSkillHost", () => {
  test("the roster names each skill by its server and says where it came from", async () => {
    const { host } = await hostFor({ acme: ACME }, [stdioServer("acme")])

    expect(await host.roster(NONE)).toEqual([
      { name: "acme:refunds", description: "Issue a refund.", server: "acme", uri: "skill://acme/refunds/SKILL.md" },
    ])
  })

  test("two skills sharing a name on one server are told apart by their path", async () => {
    const twin = (description: string) => `---\nname: refunds\ndescription: ${description}\n---\nbody`
    const spec: SkillServerSpec = {
      skills: { "acme/billing/refunds": { "SKILL.md": twin("Billing.") }, "acme/support/refunds": { "SKILL.md": twin("Support.") } },
    }
    const { host } = await hostFor({ acme: spec }, [stdioServer("acme")])

    expect((await host.roster(NONE)).map((entry) => entry.name)).toEqual(["acme:acme/billing/refunds", "acme:acme/support/refunds"])
  })

  test("a skill whose name matches a local command is prefixed with mcp: instead of shadowing it", async () => {
    const { host } = await hostFor({ acme: ACME }, [stdioServer("acme")])

    expect((await host.roster(new Set(["acme:refunds"]))).map((entry) => entry.name)).toEqual(["mcp:acme:refunds"])
  })

  test("a server with skills switched off contributes nothing and is never contacted", async () => {
    const { host, port } = await hostFor({ acme: ACME, other: ACME }, [stdioServer("acme"), stdioServer("other", { skills: false })])

    expect((await host.roster(NONE)).map((entry) => entry.server)).toEqual(["acme"])
    expect(port.discoverCalls).toEqual(["acme"])
  })

  test("a server that never answers cannot hold the roster past the wait", async () => {
    const { host, clock } = await hostFor({ acme: ACME, slow: { skills: {}, hangs: true } }, [stdioServer("slow")])

    const pending = host.roster(NONE, 3000)
    clock.fireTimers()

    expect(await pending).toEqual([])
  })

  test("a ttl below the floor still holds the listing for a minute", async () => {
    const { host, port, clock } = await hostFor({ acme: { ...ACME, ttlMs: 1 } }, [stdioServer("acme")])
    await host.roster(NONE)

    clock.advance(30_000)
    await host.roster(NONE)
    expect(port.discoverCalls).toHaveLength(1)

    clock.advance(31_000)
    await host.roster(NONE)
    expect(port.discoverCalls).toHaveLength(2)
  })

  test("read_skill returns the instructions under a header naming the server and calling them untrusted", async () => {
    const { host } = await hostFor({ acme: ACME }, [stdioServer("acme")])
    await host.refresh()

    const outcome = await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")

    expect(outcome.ok).toBe(true)
    if (!outcome.ok) return
    expect(outcome.text).toContain('MCP server "acme"')
    expect(outcome.text).toContain("untrusted")
    expect(outcome.text).toContain("Read references/policy.md first.")
  })

  test("a SKILL.md whose bytes differ from the manifest is refused, not loaded", async () => {
    const tampered = { "skill://acme/refunds/SKILL.md": REFUNDS_SKILL.replace("Refunds", "Reborns") }
    const { host } = await hostFor({ acme: { ...ACME, tampered } }, [stdioServer("acme")])
    await host.refresh()

    const outcome = await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")

    expect(outcome.ok).toBe(false)
    if (outcome.ok) return
    expect(outcome.error).toContain("failed verification")
  })

  test("a supporting file cannot be read before its skill is loaded", async () => {
    const { host } = await hostFor({ acme: ACME }, [stdioServer("acme")])
    await host.refresh()

    const outcome = await host.readResource("acme", "skill://acme/refunds/references/policy.md")

    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("load the skill first") })
  })

  test("once the skill is loaded its listed files are readable and a file outside the manifest is not", async () => {
    const { host } = await hostFor({ acme: ACME }, [stdioServer("acme")])
    await host.refresh()
    await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")

    const listed = await host.readResource("acme", "skill://acme/refunds/references/policy.md")
    const unlisted = await host.readResource("acme", "skill://acme/refunds/references/secrets.md")

    expect(listed.ok && listed.text).toContain(POLICY)
    expect(unlisted.ok).toBe(false)
  })

  test("a supporting file that fails its digest is refused even after its skill loaded", async () => {
    const tampered = { "skill://acme/refunds/references/policy.md": "Refunds are free for everyone" }
    const { host } = await hostFor({ acme: { ...ACME, tampered } }, [stdioServer("acme")])
    await host.refresh()
    await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")

    const outcome = await host.readResource("acme", "skill://acme/refunds/references/policy.md")

    expect(outcome.ok).toBe(false)
  })

  test("a dynamic skill's root cannot be escaped with dot segments, plain or percent-encoded", async () => {
    const { host } = await hostFor({ acme: { ...ACME, dynamic: true } }, [stdioServer("acme")])
    await host.refresh()
    const loaded = await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")
    expect(loaded.ok).toBe(true)

    const plain = await host.readResource("acme", "skill://acme/refunds/../other/SKILL.md")
    const encoded = await host.readResource("acme", "skill://acme/refunds/%2e%2E/other/SKILL.md")

    expect(plain).toEqual({ ok: false, error: expect.stringContaining("path segment") })
    expect(encoded).toEqual({ ok: false, error: expect.stringContaining("path segment") })
  })

  test("another server's skill is out of reach of a loaded skill's server", async () => {
    const { host } = await hostFor({ acme: ACME, other: ACME }, [stdioServer("acme"), stdioServer("other")])
    await host.refresh()
    await host.loadSkill("acme", "skill://acme/refunds/SKILL.md")

    const outcome = await host.readResource("other", "skill://acme/refunds/references/policy.md")

    expect(outcome).toEqual({ ok: false, error: expect.stringContaining("load the skill first") })
  })
})
