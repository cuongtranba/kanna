import { describe, expect, test } from "bun:test"
import { createLocalSkillAccess, type SkillCatalog } from "./skill-invocation"
import type { SkillRosterEntry } from "../shared/kanna-system-prompt"

const SKILL_FILE = "/proj/.claude/skills/kanna-test/SKILL.md"
const COMMAND_FILE = "/proj/.claude/commands/review.md"

const SKILLS: SkillRosterEntry[] = [
  { name: "kanna-test", description: "Run the gates.", filePath: SKILL_FILE },
]

const CATALOG: SkillCatalog = {
  resolve: (_cwd, name) => {
    const key = name.toLowerCase()
    if (key === "kanna-test") return { name: "kanna-test", kind: "skill", filePath: SKILL_FILE }
    if (key === "review") return { name: "review", kind: "command", filePath: COMMAND_FILE }
    return null
  },
  skills: () => SKILLS,
}

const BODIES: Record<string, string> = {
  [SKILL_FILE]: "---\nname: kanna-test\n---\nRun the gates.\n",
  [COMMAND_FILE]: "Review $ARGUMENTS.\n",
}

function makeAccess(over: {
  catalog?: SkillCatalog | null
  cwd?: (chatId: string) => string | undefined
  read?: (filePath: string) => string | null
} = {}) {
  return createLocalSkillAccess(
    over.catalog === undefined ? CATALOG : over.catalog,
    over.cwd ?? (() => "/proj"),
    over.read ?? ((filePath) => BODIES[filePath] ?? null),
  )
}

describe("expandSlashCommand", () => {
  test("expands a skill into its instructions", () => {
    const out = makeAccess().expandSlashCommand("chat-1", "/kanna-test src")
    expect(out?.name).toBe("kanna-test")
    expect(out?.kind).toBe("skill")
    expect(out?.prompt).toContain("Run the gates.")
  })

  test("expands a command with its arguments substituted", () => {
    const out = makeAccess().expandSlashCommand("chat-1", "/review src/foo.ts")
    expect(out?.prompt).toBe("Review src/foo.ts.")
    expect(out?.kind).toBe("command")
  })

  test("reports the CATALOG's spelling, not the user's casing", () => {
    expect(makeAccess().expandSlashCommand("chat-1", "/Review x")?.name).toBe("review")
  })

  test("an ordinary message is left alone", () => {
    expect(makeAccess().expandSlashCommand("chat-1", "how do I test?")).toBeNull()
  })

  test("an unknown name falls through rather than failing the send", () => {
    expect(makeAccess().expandSlashCommand("chat-1", "/nope arg")).toBeNull()
  })

  test("an unreadable file falls through", () => {
    expect(makeAccess({ read: () => null }).expandSlashCommand("chat-1", "/review x")).toBeNull()
  })

  test("an empty body falls through", () => {
    const access = makeAccess({ read: () => "---\nname: x\n---\n" })
    expect(access.expandSlashCommand("chat-1", "/review")).toBeNull()
  })

  test("carries the lines the user typed under the command", () => {
    const out = makeAccess().expandSlashCommand("chat-1", "/review src/foo.ts\n\nskip the tests")
    expect(out?.prompt).toContain("skip the tests")
  })

  test("resolves against the CHAT's cwd, so one project cannot see another's", () => {
    const seen: string[] = []
    const catalog: SkillCatalog = {
      resolve: (cwd, name) => {
        seen.push(cwd)
        return CATALOG.resolve(cwd, name)
      },
      skills: () => [],
    }
    makeAccess({ catalog, cwd: () => "/other" }).expandSlashCommand("chat-1", "/review")
    expect(seen).toEqual(["/other"])
  })

  test("no catalog means nothing local, not a crash", () => {
    expect(makeAccess({ catalog: null }).expandSlashCommand("chat-1", "/review")).toBeNull()
  })

  test("a chat with no resolvable cwd expands nothing", () => {
    expect(makeAccess({ cwd: () => undefined }).expandSlashCommand("chat-1", "/review")).toBeNull()
  })

  test("a throwing catalog degrades instead of failing the send", () => {
    const catalog: SkillCatalog = {
      resolve: () => { throw new Error("EACCES") },
      skills: () => [],
    }
    expect(makeAccess({ catalog }).expandSlashCommand("chat-1", "/review")).toBeNull()
  })
})

describe("listSkills", () => {
  test("returns the catalog's skills for the chat's cwd", () => {
    expect(makeAccess().listSkills("chat-1")).toEqual(SKILLS)
  })

  test("no catalog, no cwd, or a throwing scan all yield an empty roster", () => {
    expect(makeAccess({ catalog: null }).listSkills("chat-1")).toEqual([])
    expect(makeAccess({ cwd: () => undefined }).listSkills("chat-1")).toEqual([])
    const throwing: SkillCatalog = {
      resolve: () => null,
      skills: () => { throw new Error("EACCES") },
    }
    expect(makeAccess({ catalog: throwing }).listSkills("chat-1")).toEqual([])
  })
})
