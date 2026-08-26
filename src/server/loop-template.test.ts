import { describe, expect, test } from "bun:test"
import path from "node:path"
import {
  assertTrackingFileSafe,
  auditOracle,
  decideLoopAction,
  extractOracleScriptPath,
  LOOP_SECTIONS,
  reconcileTrackingFile,
  validateLoopSetup,
  __testing,
  type LoopSetupContext,
} from "./loop-template"

// A valid context most tests share: two auto-trigger subagents, first is default.
const CTX: LoopSetupContext = {
  roster: [
    { id: "sub-1", name: "worker", triggerMode: "auto" },
    { id: "sub-2", name: "reviewer", triggerMode: "auto" },
  ],
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
      { roster: [{ id: "sub-1", name: "worker", triggerMode: "auto" }], defaultLoopSubagentId: null },
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
      { roster: [{ id: "sub-1", name: "worker", triggerMode: "auto" }], defaultLoopSubagentId: "stale-id" },
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
  const BASE = {
    goal: "green build",
    verifyCommand: "make check",
    trackingFileRel: "PROGRESS.md",
    subagentId: "sub-1",
    parallelism: 1,
    workdirRel: ".",
  }

  test("prompt echoes the goal + verify command in the reference block", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("Goal (for reference): green build")
    expect(prompt).toContain("Verify command: `make check`")
    expect(prompt).toContain("subagent_id: \"sub-1\"")
  })

  // Regression: the rendered tool calls used to omit `file:`, so a loop with a
  // non-default tracking file had its worker silently write into PROGRESS.md.
  // Observed in the wild: a worker polluted a COMMITTED PROGRESS.md belonging
  // to a previous, finished loop.
  test("every rendered tracking-file tool call names the file explicitly", () => {
    const prompt = __testing.renderLoopPrompt({ ...BASE, trackingFileRel: "docs/PROGRESS-panes.md" })
    expect(prompt).not.toContain("PROGRESS.md\"")
    // Both the orchestrator's own read and the delegated worker's calls
    for (const call of ["query_tracking_file", "append_tracking_row", "replace_tracking_section"]) {
      const idx = prompt.indexOf(call)
      expect(idx).toBeGreaterThan(-1)
    }
    // The rendered worker prompt carries the path into each call it prescribes
    expect(prompt.match(/docs\/PROGRESS-panes\.md/g)?.length ?? 0).toBeGreaterThanOrEqual(4)
  })

  // The oracle is a proxy; the plan is the authority. A verify command that
  // passes while the plan still lists work means the oracle is too weak, not
  // that the goal is met.
  test("GOAL MET is gated on the plan being exhausted, not the exit code alone", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("Next chunk")
    expect(prompt).toContain("BOTH")
    expect(prompt).toContain("ORACLE TOO WEAK")
  })

  // Regression: a worker wrote DONE into "Next chunk" while five undone chunks
  // sat in a non-canonical "## Chunks" section nobody ever read, and a
  // grep-shaped oracle was green — so the loop declared GOAL MET on an
  // unfinished feature. GOAL MET must survive one whole-plan read, not one
  // worker-authored section.
  test("GOAL MET requires a terminal whole-plan check across every section", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("TERMINAL CHECK")
    expect(prompt).toContain("EVERY section")
    // The terminal check reads the whole file: the call carries no sections filter.
    expect(prompt).toContain("with NO sections filter")
    // Case (b) covers work found by the terminal check, not just "Next chunk".
    expect(prompt).toMatch(/ORACLE TOO WEAK[\s\S]*any other section|any other section[\s\S]*ORACLE TOO WEAK/)
  })

  test("the whole-file ban carves out exactly the terminal check", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("EXCEPT the single TERMINAL CHECK")
  })

  test("worker re-reads the whole plan before it may write DONE", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("Before writing DONE")
  })

  test("the terminal-check reads name the tracking file explicitly", () => {
    const prompt = __testing.renderLoopPrompt({ ...BASE, trackingFileRel: "docs/PROGRESS-panes.md" })
    // Neither the orchestrator's terminal check nor the worker's pre-DONE
    // check may fall back to the default PROGRESS.md.
    expect(prompt).not.toContain("PROGRESS.md\"")
  })

  // Regression: the worker prompt is identical every iteration, so without a
  // marker naming the chunk, every Progress row read the same boilerplate
  // ("Do the next chunk in PROGRESS-….md. All work happens in /home/…").
  test("worker prompt opens with a [chunk: …] marker the orchestrator substitutes", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("prompt: \"[chunk: <one-line summary of the Next chunk you just read>]")
    // And step 4 tells it that this is the one edit it makes.
    expect(prompt).toContain("only edit you make")
  })

  test("worker replaces (not appends) the Next chunk section", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("replace_tracking_section")
    expect(prompt).toMatch(/replace_tracking_section[^\n]*Next chunk/)
  })

  test("carries an infra-vs-work retry policy so a transient failure does not kill the loop", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("AUTH_REQUIRED")
    expect(prompt).toContain("Failed approaches")
    expect(prompt).toContain("do NOT call stop_loop")
  })

  test("parallelism 1 renders the single-delegation rule", () => {
    const prompt = __testing.renderLoopPrompt(BASE)
    expect(prompt).toContain("Exactly ONE delegate_subagent per turn")
    expect(prompt).not.toContain("[parallel]")
  })

  test("parallelism > 1 opts in to marked chunks, each in its own worktree", () => {
    const prompt = __testing.renderLoopPrompt({ ...BASE, parallelism: 3 })
    expect(prompt).toContain("[parallel]")
    expect(prompt).toContain("up to 3")
    expect(prompt).toContain("its OWN git worktree")
  })

  test("a non-default workdir is named as the verify + work directory", () => {
    const prompt = __testing.renderLoopPrompt({ ...BASE, workdirRel: "../wt-feature" })
    expect(prompt).toContain("../wt-feature")
  })
})

describe("validateLoopSetup — worker trigger mode", () => {
  const cwd = "/tmp/kanna-loop-test-project"

  // Regression: the roster passed to validate used to be {id,name} only, so a
  // manual-trigger subagent armed fine and the loop only discovered
  // MANUAL_ONLY one full iteration later — after the context wipe.
  test("rejects a manual-trigger subagent instead of arming a loop that cannot delegate", () => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true", subagentId: "manual-1" }, cwd, {
      roster: [
        { id: "sub-1", name: "worker", triggerMode: "auto" },
        { id: "manual-1", name: "handy", triggerMode: "manual" },
      ],
      defaultLoopSubagentId: "sub-1",
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("handy") && e.includes("manual"))).toBe(true)
  })

  test("rejects a manual-trigger subagent that arrives via the configured default", () => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true" }, cwd, {
      roster: [{ id: "manual-1", name: "handy", triggerMode: "manual" }],
      defaultLoopSubagentId: "manual-1",
    })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("manual"))).toBe(true)
  })
})

describe("validateLoopSetup — workdir + parallelism", () => {
  const cwd = "/tmp/kanna-loop-test-project"

  test("defaults workdir to the project cwd and parallelism to 1", () => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true" }, cwd, CTX)
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.workdirAbs).toBe(cwd)
    expect(result.resolved.parallelism).toBe(1)
  })

  // The project rule is "always use a git worktree", so the work — and the
  // tracking file describing it — routinely lives in a SIBLING directory.
  test("an explicit workdir becomes the tracking-file base and is echoed in the prompt", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", workdir: "/tmp/kanna-wt-feature", trackingFile: "PROGRESS.md" },
      cwd,
      CTX,
    )
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.workdirAbs).toBe("/tmp/kanna-wt-feature")
    expect(result.resolved.trackingFileAbs).toBe("/tmp/kanna-wt-feature/PROGRESS.md")
  })

  test("rejects a tracking file that escapes the workdir", () => {
    const result = validateLoopSetup(
      { goal: "g", verifyCommand: "true", workdir: "/tmp/kanna-wt-feature", trackingFile: "../escape.md" },
      cwd,
      CTX,
    )
    expect(result.ok).toBe(false)
  })

  test("rejects a non-absolute workdir", () => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true", workdir: "relative/dir" }, cwd, CTX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("workdir"))).toBe(true)
  })

  test.each([0, -1, 1.5, 99])("rejects parallelism %p", (parallelism) => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true", parallelism }, cwd, CTX)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.errors.some((e) => e.includes("parallelism"))).toBe(true)
  })

  test("accepts parallelism within the permit bound", () => {
    const result = validateLoopSetup({ goal: "g", verifyCommand: "true", parallelism: 4 }, cwd, CTX)
    if (!result.ok) throw new Error(result.errors.join(", "))
    expect(result.resolved.parallelism).toBe(4)
  })
})

describe("extractOracleScriptPath", () => {
  test("finds the script token whether bare or behind an interpreter", () => {
    expect(extractOracleScriptPath("bash .loop-verify.sh")).toBe(".loop-verify.sh")
    expect(extractOracleScriptPath("./ci/check.sh --fast")).toBe("./ci/check.sh")
    expect(extractOracleScriptPath('sh "gate.bash"')).toBe("gate.bash")
  })

  test("skips flag tokens so `bash -x gate.sh` still resolves", () => {
    expect(extractOracleScriptPath("bash -x gate.sh")).toBe("gate.sh")
  })

  test("returns null for commands that reference no shell script", () => {
    expect(extractOracleScriptPath("bun run lint")).toBeNull()
    expect(extractOracleScriptPath("task check")).toBeNull()
  })
})

describe("auditOracle", () => {
  // The false-green incident: an oracle of file-existence probes + greps armed
  // silently, every marker was satisfied by files nothing called, and the loop
  // declared GOAL MET on an unfinished feature. The audit exists to say so at
  // arm time, while the operator can still tighten the command.
  test("warns when the oracle is only existence probes and greps", () => {
    const script = [
      "#!/usr/bin/env bash",
      "test -f backend/src/auth/instance.ts || exit 1",
      "[ -f backend/src/lib/adapter.ts ] || exit 1",
      "grep -q better-auth backend/package.json || exit 1",
      "ls docs/adr/0027-*.md >/dev/null 2>&1 || exit 1",
    ].join("\n")
    const warnings = auditOracle({
      verifyCommand: "bash .loop-verify.sh",
      scriptPath: ".loop-verify.sh",
      scriptContent: script,
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("can pass without the behavior existing")
  })

  test("stays silent for a test-runner oracle", () => {
    for (const command of ["bun test", "task check", "pnpm test", "go test ./..."]) {
      expect(auditOracle({ verifyCommand: command, scriptPath: null, scriptContent: null })).toEqual([])
    }
  })

  test("soft-warns when many markers gate an otherwise real test run", () => {
    const script = [
      "test -f a.ts || exit 1",
      "test -f b.ts || exit 1",
      "grep -q tenantSlug src/auth.ts && exit 1",
      "grep -q newFlag src/config.ts || exit 1",
      "task check",
    ].join("\n")
    const warnings = auditOracle({
      verifyCommand: "bash gate.sh",
      scriptPath: "gate.sh",
      scriptContent: script,
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("green legacy suite")
  })

  test("one or two fail-fast markers before a real gate stay silent", () => {
    const script = ["grep -q DONE PLAN.md || exit 1", "bun test"].join("\n")
    expect(
      auditOracle({ verifyCommand: "bash gate.sh", scriptPath: "gate.sh", scriptContent: script }),
    ).toEqual([])
  })

  test("audits the inline command when it references no script", () => {
    const warnings = auditOracle({
      verifyCommand: "grep -q SplitContainer src/App.tsx",
      scriptPath: null,
      scriptContent: null,
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("can pass without the behavior existing")
  })

  test("reports an unreadable referenced script instead of guessing", () => {
    const warnings = auditOracle({
      verifyCommand: "bash missing.sh",
      scriptPath: "missing.sh",
      scriptContent: null,
    })
    expect(warnings.length).toBe(1)
    expect(warnings[0]).toContain("could not be read")
  })

  test("an opaque command with no markers and no known runner stays silent", () => {
    expect(
      auditOracle({ verifyCommand: "./ci/gate", scriptPath: null, scriptContent: null }),
    ).toEqual([])
  })
})

describe("assertTrackingFileSafe", () => {
  // Regression: setup_loop reconciled a COMMITTED PROGRESS.md belonging to a
  // finished, unrelated loop — silently rewriting its Goal and Verify command
  // sections. Committed history must not be clobbered without consent.
  const committed = "# Old loop\n\n## Goal\nship the old thing\n\n## Verify command\n```\nmake old\n```\n"

  test("refuses to rewrite the goal of a git-tracked file", () => {
    const result = assertTrackingFileSafe(committed, { goal: "ship the NEW thing", gitTracked: true, force: false })
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error("expected reject")
    expect(result.error).toContain("ship the old thing")
    expect(result.error).toContain("force")
  })

  test("force: true overrides the refusal", () => {
    const result = assertTrackingFileSafe(committed, { goal: "ship the NEW thing", gitTracked: true, force: true })
    expect(result.ok).toBe(true)
  })

  test("an untracked file is fair game — nothing committed is at risk", () => {
    const result = assertTrackingFileSafe(committed, { goal: "ship the NEW thing", gitTracked: false, force: false })
    expect(result.ok).toBe(true)
  })

  test("re-arming the SAME goal on a tracked file is allowed (idempotent re-setup)", () => {
    const result = assertTrackingFileSafe(committed, { goal: "ship the old thing", gitTracked: true, force: false })
    expect(result.ok).toBe(true)
  })

  test("a tracked file with no Goal section yet is allowed", () => {
    const result = assertTrackingFileSafe("# notes\n\nfree text\n", { goal: "g", gitTracked: true, force: false })
    expect(result.ok).toBe(true)
  })
})

describe("decideLoopAction", () => {
  test("oracle=0 + empty next chunk → GOAL_MET", () => {
    expect(decideLoopAction(0, "empty")).toBe("GOAL_MET")
  })

  test("oracle=0 + has_work next chunk → ORACLE_TOO_WEAK", () => {
    expect(decideLoopAction(0, "has_work")).toBe("ORACLE_TOO_WEAK")
  })

  test("oracle=nonzero + has_work next chunk → DELEGATE", () => {
    expect(decideLoopAction("nonzero", "has_work")).toBe("DELEGATE")
  })

  test("oracle=nonzero + empty next chunk → WRITE_CHUNK", () => {
    expect(decideLoopAction("nonzero", "empty")).toBe("WRITE_CHUNK")
  })
})

describe("LOOP_SECTIONS constants", () => {
  test("section names are stable string values consumed by the prompt", () => {
    expect(LOOP_SECTIONS.nextChunk).toBe("Next chunk")
    expect(LOOP_SECTIONS.progress).toBe("Progress")
    expect(LOOP_SECTIONS.failedApproaches).toBe("Failed approaches")
  })

  test("rendered prompt contains LOOP_SECTIONS values, not independent literals", () => {
    const prompt = __testing.renderLoopPrompt({
      goal: "green build",
      verifyCommand: "make check",
      trackingFileRel: "PROGRESS.md",
      subagentId: "sub-1",
      parallelism: 1,
      workdirRel: ".",
    })
    expect(prompt).toContain(LOOP_SECTIONS.nextChunk)
    expect(prompt).toContain(LOOP_SECTIONS.progress)
    expect(prompt).toContain(LOOP_SECTIONS.failedApproaches)
  })
})
