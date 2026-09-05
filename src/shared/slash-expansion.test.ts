import { describe, expect, test } from "bun:test"
import {
  buildSlashExpansion,
  parseSlashInvocation,
  splitArguments,
  stripFrontmatter,
  substituteArguments,
} from "./slash-expansion"

describe("parseSlashInvocation", () => {
  test("reads a bare command", () => {
    expect(parseSlashInvocation("/review")).toEqual({ name: "review", args: "", trailing: "" })
  })

  test("captures arguments verbatim after the name", () => {
    expect(parseSlashInvocation("/review src/foo.ts  --deep")).toEqual({
      name: "review",
      args: "src/foo.ts  --deep",
      trailing: "",
    })
  })

  test("tolerates the trailing space the typeahead appends", () => {
    expect(parseSlashInvocation("/review ")).toEqual({ name: "review", args: "", trailing: "" })
  })

  test("accepts a plugin-namespaced name", () => {
    expect(parseSlashInvocation("/skill-stack:go:audit")?.name).toBe("skill-stack:go:audit")
  })

  test("accepts a nested project command name", () => {
    expect(parseSlashInvocation("/ci/deploy staging")?.name).toBe("ci/deploy")
  })

  test("keeps lines after the first as trailing context instead of refusing", () => {
    expect(parseSlashInvocation("/review src/foo.ts\n\nfocus on the auth path\n")).toEqual({
      name: "review",
      args: "src/foo.ts",
      trailing: "focus on the auth path",
    })
  })

  test("tolerates leading whitespace, exactly as parseBuiltinCommand does", () => {
    expect(parseSlashInvocation("  /review")?.name).toBe("review")
  })

  test.each([
    ["", "empty"],
    ["hello", "no leading slash"],
    ["/", "slash alone"],
    ["//clear", "double slash"],
    ["/ review", "space before the name"],
  ])("rejects %p (%s)", (input) => {
    expect(parseSlashInvocation(input)).toBeNull()
  })
})

describe("stripFrontmatter", () => {
  test("drops a leading YAML block", () => {
    expect(stripFrontmatter("---\nname: review\n---\nBody line\n")).toBe("Body line\n")
  })

  test("leaves a file with no frontmatter untouched", () => {
    expect(stripFrontmatter("# Heading\n\nBody\n")).toBe("# Heading\n\nBody\n")
  })

  test("leaves an unterminated block untouched rather than swallowing the file", () => {
    expect(stripFrontmatter("---\nname: review\nBody\n")).toBe("---\nname: review\nBody\n")
  })

  test("tolerates CRLF line endings", () => {
    expect(stripFrontmatter("---\r\nname: review\r\n---\r\nBody\r\n")).toBe("Body\r\n")
  })

  test("a file that is only frontmatter has an empty body", () => {
    expect(stripFrontmatter("---\nname: review\n---\n")).toBe("")
  })
})

describe("splitArguments", () => {
  test("splits on whitespace", () => {
    expect(splitArguments("a b   c")).toEqual(["a", "b", "c"])
  })

  test("keeps a double-quoted run together", () => {
    expect(splitArguments('a "b c" d')).toEqual(["a", "b c", "d"])
  })

  test("keeps a single-quoted run together", () => {
    expect(splitArguments("a 'b c'")).toEqual(["a", "b c"])
  })

  test("an unterminated quote still yields its content", () => {
    expect(splitArguments('a "b c')).toEqual(["a", "b c"])
  })
})

describe("substituteArguments", () => {
  test("replaces $ARGUMENTS everywhere with the whole argument string", () => {
    expect(substituteArguments("Run $ARGUMENTS, then re-run $ARGUMENTS", "a b")).toBe(
      "Run a b, then re-run a b",
    )
  })

  test("replaces positional $1..$9", () => {
    expect(substituteArguments("$1 then $2", "first second")).toBe("first then second")
  })

  test("a positional with no argument collapses to nothing", () => {
    expect(substituteArguments("[$1][$2]", "only")).toBe("[only][]")
  })

  test("does not re-substitute markers that came from the arguments", () => {
    expect(substituteArguments("$ARGUMENTS", "$1")).toBe("$1")
  })

  test("leaves a dollar sign that is not a marker alone", () => {
    expect(substituteArguments("$0 and $x and $ARGUMENTS", "more")).toBe("$0 and $x and more")
  })

  test("$1..$9 ARE markers even when they read as money — same as the CLI", () => {
    expect(substituteArguments("costs $5", "")).toBe("costs ")
  })
})

const SKILL_SOURCE = {
  name: "kanna-test",
  kind: "skill",
  filePath: "/repo/.claude/skills/kanna-test/SKILL.md",
} as const

const COMMAND_SOURCE = {
  name: "review",
  kind: "command",
  filePath: "/repo/.claude/commands/review.md",
} as const

describe("buildSlashExpansion — command", () => {
  test("is the substituted body verbatim, with no envelope", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "---\ndescription: x\n---\nReview $ARGUMENTS carefully.\n",
      invocation: { name: "review", args: "src/foo.ts", trailing: "" },
    })
    expect(prompt).toBe("Review src/foo.ts carefully.")
  })

  test("appends the lines the user typed after the command", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "Review the diff.",
      invocation: { name: "review", args: "", trailing: "Ignore generated files." },
    })
    expect(prompt).toBe("Review the diff.\n\nIgnore generated files.")
  })
})

describe("buildSlashExpansion — skill", () => {
  const prompt = buildSlashExpansion({
    source: SKILL_SOURCE,
    body: "---\nname: kanna-test\n---\n# How to test\n\nRun `bun run test`.\n",
    invocation: { name: "kanna-test", args: "src/server", trailing: "" },
  })

  test("names the skill so the model knows what it was asked to run", () => {
    expect(prompt).toContain("kanna-test")
  })

  test("names the skill DIRECTORY, not the file, so bundled references are reachable", () => {
    expect(prompt).toContain("/repo/.claude/skills/kanna-test")
    expect(prompt).not.toContain("SKILL.md")
  })

  test("states the arguments separately from the body", () => {
    expect(prompt).toContain("src/server")
  })

  test("carries the instructions with the frontmatter stripped", () => {
    expect(prompt).toContain("Run `bun run test`.")
    expect(prompt).not.toContain("name: kanna-test")
  })

  test("omits the arguments line when none were given", () => {
    const bare = buildSlashExpansion({
      source: SKILL_SOURCE,
      body: "Do the thing.",
      invocation: { name: "kanna-test", args: "", trailing: "" },
    })
    expect(bare).not.toContain("Arguments")
  })
})

describe("buildSlashExpansion — Claude Code shorthand", () => {
  test("explains !`cmd` rather than executing it", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "Current branch: !`git branch --show-current`",
      invocation: { name: "review", args: "", trailing: "" },
    })
    expect(prompt).toContain("!`git branch --show-current`")
    expect(prompt).toContain("run that shell command")
  })

  test("explains an @path reference", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "Review @src/foo.ts against the spec.",
      invocation: { name: "review", args: "", trailing: "" },
    })
    expect(prompt).toContain("read it yourself")
  })

  test("adds no note when the body uses neither", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "Review the diff.",
      invocation: { name: "review", args: "", trailing: "" },
    })
    expect(prompt).not.toContain("shorthand")
  })

  test("an email address is not mistaken for an @path reference", () => {
    const prompt = buildSlashExpansion({
      source: COMMAND_SOURCE,
      body: "Mail a@b.com when done.",
      invocation: { name: "review", args: "", trailing: "" },
    })
    expect(prompt).not.toContain("shorthand")
  })
})
