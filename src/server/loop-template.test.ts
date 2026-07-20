import { describe, expect, test } from "bun:test"
import path from "node:path"
import { reconcileTrackingFile, validateLoopSetup, __testing, type LoopSetupContext } from "./loop-template"

// A valid context most tests share: one known subagent, set as the default.
const CTX: LoopSetupContext = {
  roster: [{ id: "sub-1", name: "worker" }, { id: "sub-2", name: "reviewer" }],
  defaultLoopSubagentId: "sub-1",
}

describe("validateLoopSetup — happy path", () => {
  const cwd = "/tmp/kanna-loop-test-project"

  test("returns ok with fully-resolved template + skeleton when inputs are valid", () => {
    const result = validateLoopSetup(
      {
        goal: "eslint --max-warnings=0 passes",
        verifyCommand: "bun run lint",
        chunkHint: "start with warnings in src/client/**",
      },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(`expected ok, got errors: ${result.errors.join(", ")}`)
    expect(result.resolved.goal).toBe("eslint --max-warnings=0 passes")
    expect(result.resolved.verifyCommand).toBe("bun run lint")
    expect(result.resolved.trackingFileRel).toBe("PROGRESS.md")
    expect(result.resolved.trackingFileAbs).toBe(path.join(cwd, "PROGRESS.md"))
    expect(result.resolved.chunkHint).toBe("start with warnings in src/client/**")
    // Defaulted worker resolved from context
    expect(result.resolved.subagentId).toBe("sub-1")
    // Rendered prompt embeds every required clause verbatim
    expect(result.resolved.prompt).toContain("PROGRESS.md")
    expect(result.resolved.prompt).toContain("bun run lint")
    expect(result.resolved.prompt).toContain("delegate_subagent")
    expect(result.resolved.prompt).toContain("run_in_background: true")
    expect(result.resolved.prompt).toContain("GOAL MET")
    expect(result.resolved.prompt).toContain("END THIS TURN")
    expect(result.resolved.prompt).toContain("/clear")
    // Hardening: the concrete subagent id + stop_loop + no-self-edit rule
    expect(result.resolved.prompt).toContain("sub-1")
    expect(result.resolved.prompt).toContain("stop_loop")
    expect(result.resolved.prompt).toContain("NEVER edit code yourself")
    // Skeleton includes goal + verify command
    expect(result.resolved.skeleton).toContain("eslint --max-warnings=0 passes")
    expect(result.resolved.skeleton).toContain("bun run lint")
    expect(result.resolved.skeleton).toContain("start with warnings in src/client/**")
  })

  test("explicit subagentId overrides the configured default", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", subagentId: "sub-2" },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.subagentId).toBe("sub-2")
    expect(result.resolved.prompt).toContain("sub-2")
  })

  test("respects custom relative tracking file path inside cwd", () => {
    const result = validateLoopSetup(
      {
        goal: "tests pass",
        verifyCommand: "bun test",
        trackingFile: "docs/LOOP-STATE.md",
      },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.trackingFileRel).toBe(path.join("docs", "LOOP-STATE.md"))
    expect(result.resolved.trackingFileAbs).toBe(path.join(cwd, "docs", "LOOP-STATE.md"))
    expect(result.resolved.prompt).toContain(path.join("docs", "LOOP-STATE.md"))
  })

  test("respects an absolute tracking file path when inside cwd", () => {
    const result = validateLoopSetup(
      {
        goal: "green",
        verifyCommand: "make check",
        trackingFile: path.join(cwd, "sub", "PROG.md"),
      },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.trackingFileRel).toBe(path.join("sub", "PROG.md"))
  })

  test("chunkHint is omitted from resolved when blank/whitespace", () => {
    const result = validateLoopSetup(
      {
        goal: "g",
        verifyCommand: "true",
        chunkHint: "   ",
      },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.chunkHint).toBeNull()
    // Skeleton still renders the default placeholder line
    expect(result.resolved.skeleton).toContain("Describe the first chunk")
  })
})

describe("validateLoopSetup — subagent resolution", () => {
  const cwd = "/tmp/kanna-loop-test-project"

  test("rejects when neither explicit id nor default is set", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true" },
      cwd,
      { roster: [{ id: "sub-1", name: "worker" }], defaultLoopSubagentId: null },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("subagentId is required"))).toBe(true)
  })

  test("rejects an explicit id that is not in the roster", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", subagentId: "ghost" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("ghost") && e.includes("not a known subagent"))).toBe(true)
  })

  test("rejects a default id that is not in the roster", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true" },
      cwd,
      { roster: [{ id: "sub-1", name: "worker" }], defaultLoopSubagentId: "stale-id" },
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("stale-id"))).toBe(true)
  })
})

describe("validateLoopSetup — rejections", () => {
  const cwd = "/tmp/kanna-loop-test-project"

  test("rejects when goal is missing / blank", () => {
    const empty = validateLoopSetup({ goal: "", verifyCommand: "x" }, cwd, CTX)
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error("expected reject")
    expect(empty.errors.some((e) => e.includes("goal"))).toBe(true)

    const blank = validateLoopSetup({ goal: "   ", verifyCommand: "x" }, cwd, CTX)
    expect(blank.ok).toBe(false)

    // Not-a-string via type cast simulates an SDK payload with the wrong shape.
    const notString = validateLoopSetup(
      { goal: 42 as unknown as string, verifyCommand: "x" },
      cwd,
      CTX,
    )
    expect(notString.ok).toBe(false)
  })

  test("rejects when goal exceeds max length", () => {
    const overlong = "a".repeat(501)
    const result = validateLoopSetup({ goal: overlong, verifyCommand: "x" }, cwd, CTX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("500"))).toBe(true)
  })

  test("rejects when verifyCommand is missing or blank", () => {
    const empty = validateLoopSetup({ goal: "g", verifyCommand: "" }, cwd, CTX)
    expect(empty.ok).toBe(false)
    if (empty.ok) throw new Error("expected reject")
    expect(empty.errors.some((e) => e.includes("verifyCommand"))).toBe(true)
  })

  test("rejects when verifyCommand is unparseable (unmatched quotes)", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "echo 'unclosed" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("verifyCommand"))).toBe(true)
  })

  test("rejects when trackingFile escapes cwd via ..", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", trackingFile: "../escaped.md" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("resolve inside"))).toBe(true)
  })

  test("rejects an absolute trackingFile path outside cwd", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", trackingFile: "/etc/passwd" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
  })

  test("rejects a trackingFile that resolves to cwd itself (empty relative)", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", trackingFile: cwd },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
  })

  test("rejects when trackingFile contains a NUL byte", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", trackingFile: "PROG\0RESS.md" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
  })

  test("rejects when chunkHint exceeds max length", () => {
    const overlong = "a".repeat(2001)
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", chunkHint: overlong },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("chunkHint"))).toBe(true)
  })

  test("collects multiple errors in one pass (does not fail-fast)", () => {
    const result = validateLoopSetup(
      { goal: "", verifyCommand: "" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.length).toBeGreaterThanOrEqual(2)
  })
})

describe("resolveTrackingFile edge cases", () => {
  test("blank string trackingFile is rejected explicitly", () => {
    const r = __testing.resolveTrackingFile("   ", "/tmp/x")
    expect("error" in r).toBe(true)
  })

  test("Windows-style separators normalize to POSIX before confining", () => {
    const r = __testing.resolveTrackingFile("docs\\PROG.md", "/tmp/x")
    if ("error" in r) throw new Error(r.error)
    expect(r.rel).toBe(path.join("docs", "PROG.md"))
  })
})

describe("reconcileTrackingFile — deterministic schema reconcile", () => {
  const ARGS = {
    goal: "eslint --max-warnings=0 passes",
    verifyCommand: "bun run lint",
    chunkHint: "start with src/client/**" as string | null,
  }

  test("a skeleton generated from the same inputs round-trips unchanged", () => {
    const skeleton = __testing.renderSkeleton(ARGS)
    const result = reconcileTrackingFile(skeleton, ARGS)
    expect(result.changed).toBe(false)
    expect(result.content).toBe(skeleton)
    expect(result.actions).toEqual([])
  })

  test("an empty file becomes exactly the canonical skeleton", () => {
    const result = reconcileTrackingFile("", ARGS)
    expect(result.changed).toBe(true)
    expect(result.content).toBe(__testing.renderSkeleton(ARGS))
    expect(result.actions).toContain('inserted "## Goal"')
    expect(result.actions).toContain('inserted "## Verify command"')
    expect(result.actions).toContain('inserted "## Progress (latest first)"')
    expect(result.actions).toContain('inserted "## Failed approaches"')
    expect(result.actions).toContain('inserted "## Next chunk"')
  })

  test("a whitespace-only file becomes exactly the canonical skeleton", () => {
    const result = reconcileTrackingFile("   \n\n  ", ARGS)
    expect(result.changed).toBe(true)
    expect(result.content).toBe(__testing.renderSkeleton(ARGS))
  })

  test("missing '## Next chunk' is inserted; other sections preserved verbatim", () => {
    const existing = [
      "# Loop tracking file",
      "",
      "## Goal",
      ARGS.goal,
      "",
      "## Verify command",
      "```",
      ARGS.verifyCommand,
      "```",
      "",
      "## Progress (latest first)",
      "",
      "- 2026-07-13 chunk 1 DONE (run-abc)",
      "",
      "## Failed approaches",
      "",
      "- naive regex broke on nested quotes",
      "",
    ].join("\n")
    const result = reconcileTrackingFile(existing, ARGS)
    expect(result.changed).toBe(true)
    expect(result.actions).toEqual(['inserted "## Next chunk"'])
    // Loop-owned history preserved byte-for-byte
    expect(result.content).toContain("- 2026-07-13 chunk 1 DONE (run-abc)")
    expect(result.content).toContain("- naive regex broke on nested quotes")
    // Inserted section carries the chunk hint
    expect(result.content).toContain("## Next chunk")
    expect(result.content).toContain("start with src/client/**")
  })

  test("mismatched goal is rewritten to the input; progress rows preserved", () => {
    const skeleton = __testing.renderSkeleton({ ...ARGS, goal: "OLD STALE GOAL" })
    const withHistory = skeleton.replace(
      "_Subagent appends one row per completed chunk here._",
      "- 2026-07-12 chunk 0 DONE",
    )
    const result = reconcileTrackingFile(withHistory, ARGS)
    expect(result.changed).toBe(true)
    expect(result.actions).toEqual(['rewrote "## Goal"'])
    expect(result.content).toContain(ARGS.goal)
    expect(result.content).not.toContain("OLD STALE GOAL")
    expect(result.content).toContain("- 2026-07-12 chunk 0 DONE")
  })

  test("mismatched verify command is rewritten to the input", () => {
    const skeleton = __testing.renderSkeleton({ ...ARGS, verifyCommand: "make old-check" })
    const result = reconcileTrackingFile(skeleton, ARGS)
    expect(result.changed).toBe(true)
    expect(result.actions).toEqual(['rewrote "## Verify command"'])
    expect(result.content).toContain("bun run lint")
    expect(result.content).not.toContain("make old-check")
  })

  test("unknown extra sections are preserved after the canonical ones", () => {
    const skeleton = __testing.renderSkeleton(ARGS)
    const existing = `${skeleton}## Notes\n\nkeep me around\n`
    const result = reconcileTrackingFile(existing, ARGS)
    expect(result.content).toContain("## Notes")
    expect(result.content).toContain("keep me around")
    // Canonical section order holds: Next chunk before the unknown section
    expect(result.content.indexOf("## Next chunk")).toBeLessThan(result.content.indexOf("## Notes"))
  })

  test("a custom preamble above the first section is preserved", () => {
    const skeleton = __testing.renderSkeleton(ARGS)
    const existing = skeleton.replace("# Loop tracking file", "# My custom loop title\n\nsome intro prose")
    const result = reconcileTrackingFile(existing, ARGS)
    expect(result.content).toContain("# My custom loop title")
    expect(result.content).toContain("some intro prose")
  })

  test("heading match is case-insensitive and tolerant of suffix text", () => {
    const existing = [
      "# t",
      "",
      "## goal",
      ARGS.goal,
      "",
      "## VERIFY COMMAND",
      "```",
      ARGS.verifyCommand,
      "```",
      "",
      "## Progress",
      "",
      "- row",
      "",
      "## Failed Approaches (dead ends)",
      "",
      "- x",
      "",
      "## next chunk",
      "",
      "do the thing",
      "",
    ].join("\n")
    const result = reconcileTrackingFile(existing, ARGS)
    // All five sections matched: nothing inserted, server-owned bodies already equal
    expect(result.actions).toEqual([])
    expect(result.changed).toBe(false)
    expect(result.content).toBe(existing)
  })

  test("null chunkHint inserts the default placeholder for a missing Next chunk", () => {
    const result = reconcileTrackingFile("", { ...ARGS, chunkHint: null })
    expect(result.content).toContain("_Describe the first chunk the subagent should do._")
  })
})

describe("renderLoopPrompt structural invariants", () => {
  test("prompt echoes the goal + verify command in the reference block", () => {
    const prompt = __testing.renderLoopPrompt({
      goal: "green build",
      verifyCommand: "make check",
      trackingFileRel: "PROGRESS.md",
      subagentId: "sub-1",
    })
    expect(prompt).toContain("Goal (for reference): green build")
    expect(prompt).toContain("Verify command: `make check`")
    expect(prompt).toContain("subagent_id: \"sub-1\"")
  })
})
