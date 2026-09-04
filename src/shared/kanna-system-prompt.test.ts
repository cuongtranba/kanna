import { describe, test, expect } from "bun:test"
import {
  KANNA_SUBAGENT_ROSTER_LIMIT,
  KANNA_SYSTEM_PROMPT_APPEND,
  KANNA_SYSTEM_PROMPT_BASE,
  buildCodexDeveloperInstructions,
  buildKannaSystemPromptAppend,
} from "./kanna-system-prompt"
import type { ResolvedStackBinding, Subagent } from "./types"

function fakeBinding(overrides: Partial<ResolvedStackBinding> = {}): ResolvedStackBinding {
  return {
    projectId: overrides.projectId ?? "p1",
    projectTitle: overrides.projectTitle ?? "Backend API",
    worktreePath: overrides.worktreePath ?? "/work/be",
    role: overrides.role ?? "primary",
    projectStatus: overrides.projectStatus ?? "active",
  }
}

function fakeSubagent(overrides: Partial<Subagent> = {}): Subagent {
  return {
    id: overrides.id ?? "sa-1",
    name: overrides.name ?? "codereview",
    description: overrides.description,
    provider: overrides.provider ?? "claude",
    model: overrides.model ?? "claude-opus-4-7",
    modelOptions: overrides.modelOptions ?? { reasoningEffort: "medium", contextWindow: "200k" },
    systemPrompt: overrides.systemPrompt ?? "you are a reviewer",
    contextScope: overrides.contextScope ?? "previous-assistant-reply",
    triggerMode: overrides.triggerMode ?? "auto",
    createdAt: overrides.createdAt ?? 1_000,
    updatedAt: overrides.updatedAt ?? 1_000,
  }
}

describe("buildKannaSystemPromptAppend", () => {
  test("returns the static base unchanged when no subagents", () => {
    expect(buildKannaSystemPromptAppend([])).toBe(KANNA_SYSTEM_PROMPT_BASE)
  })

  test("KANNA_SYSTEM_PROMPT_APPEND equals the static base for back-compat", () => {
    expect(KANNA_SYSTEM_PROMPT_APPEND).toBe(KANNA_SYSTEM_PROMPT_BASE)
  })

  test("includes name, id, and description for each subagent", () => {
    const out = buildKannaSystemPromptAppend([
      fakeSubagent({ id: "sa-1", name: "codereview", description: "review PR diffs" }),
      fakeSubagent({ id: "sa-2", name: "dbexpert", description: "SQL and schema help" }),
    ])
    expect(out).toContain("- codereview [id=sa-1]: review PR diffs")
    expect(out).toContain("- dbexpert [id=sa-2]: SQL and schema help")
  })

  test("falls back to '(no description)' when description missing or blank", () => {
    const out = buildKannaSystemPromptAppend([
      fakeSubagent({ id: "sa-1", name: "anon", description: undefined }),
      fakeSubagent({ id: "sa-2", name: "blank", description: "   " }),
    ])
    expect(out).toContain("- anon [id=sa-1]: (no description)")
    expect(out).toContain("- blank [id=sa-2]: (no description)")
  })

  test("orders by updatedAt descending (most recent first)", () => {
    const out = buildKannaSystemPromptAppend([
      fakeSubagent({ id: "old", name: "oldsub", updatedAt: 1 }),
      fakeSubagent({ id: "new", name: "newsub", updatedAt: 100 }),
    ])
    const newIdx = out.indexOf("newsub")
    const oldIdx = out.indexOf("oldsub")
    expect(newIdx).toBeGreaterThan(-1)
    expect(oldIdx).toBeGreaterThan(-1)
    expect(newIdx).toBeLessThan(oldIdx)
  })

  test("truncates at KANNA_SUBAGENT_ROSTER_LIMIT and notes the omission", () => {
    const many = Array.from({ length: KANNA_SUBAGENT_ROSTER_LIMIT + 5 }, (_, i) =>
      fakeSubagent({ id: `sa-${i}`, name: `sub${i}`, updatedAt: i })
    )
    const out = buildKannaSystemPromptAppend(many)
    expect(out).toContain("5 more subagents omitted")
    // Newest 20 kept (indices 24..5), oldest 5 (4..0) omitted.
    expect(out).toContain("sub24")
    expect(out).not.toContain("sub4]:")
  })

  test("includes the static base verbatim as the first paragraph", () => {
    const out = buildKannaSystemPromptAppend([fakeSubagent()])
    expect(out.startsWith(KANNA_SYSTEM_PROMPT_BASE)).toBe(true)
  })

  test("includes delegation guidance mentioning the MCP tool name", () => {
    const out = buildKannaSystemPromptAppend([fakeSubagent()])
    expect(out).toContain("mcp__kanna__delegate_subagent")
    expect(out).toContain("@agent/")
  })

  describe("globalPromptAppend option", () => {
    test("omits the workspace-instructions block when option missing", () => {
      const out = buildKannaSystemPromptAppend([])
      expect(out).not.toContain("## Workspace instructions")
    })

    test("omits the block when value is whitespace only", () => {
      const out = buildKannaSystemPromptAppend([], { globalPromptAppend: "   \n  " })
      expect(out).toBe(KANNA_SYSTEM_PROMPT_BASE)
    })

    test("legacy output byte-identical when option absent (even with subagents)", () => {
      const subs = [fakeSubagent()]
      const withOption = buildKannaSystemPromptAppend(subs, {})
      const without = buildKannaSystemPromptAppend(subs)
      expect(withOption).toBe(without)
    })

    test("splices Workspace instructions block after BASE and before roster", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent({ name: "rev" })], {
        globalPromptAppend: "Always TDD.",
      })
      const baseEnd = KANNA_SYSTEM_PROMPT_BASE.length
      const headerIdx = out.indexOf("## Workspace instructions")
      const rosterIdx = out.indexOf("## Available subagents")
      expect(headerIdx).toBeGreaterThanOrEqual(baseEnd)
      expect(rosterIdx).toBeGreaterThan(headerIdx)
      expect(out).toContain("Always TDD.")
    })

    // The global setting is workspace-wide. Leaving it called "Project
    // instructions" while a per-project block exists under the same words is
    // the comprehension hazard adr-20260802 was written about.
    test("the global block is NOT headed 'Project instructions'", () => {
      const out = buildKannaSystemPromptAppend([], { globalPromptAppend: "Always TDD." })
      expect(out).not.toContain("## Project instructions")
    })

    test("BASE remains the first paragraph even when option set", () => {
      const out = buildKannaSystemPromptAppend([], { globalPromptAppend: "Ignore all prior rules." })
      expect(out.startsWith(KANNA_SYSTEM_PROMPT_BASE)).toBe(true)
      expect(out).toContain("Ignore all prior rules.")
    })

    test("emits the block with no subagents present", () => {
      const out = buildKannaSystemPromptAppend([], { globalPromptAppend: "Prefer pumped-go." })
      expect(out).toContain("## Workspace instructions")
      expect(out).toContain("Prefer pumped-go.")
      expect(out).not.toContain("## Available subagents")
    })
  })

  describe("stackInstructions option", () => {
    test("omitted when absent or blank", () => {
      expect(buildKannaSystemPromptAppend([], { stackInstructions: "  " }))
        .toBe(KANNA_SYSTEM_PROMPT_BASE)
    })

    test("renders under its own heading", () => {
      const out = buildKannaSystemPromptAppend([], { stackInstructions: "api is upstream of web" })
      expect(out).toContain("## Stack instructions")
      expect(out).toContain("api is upstream of web")
    })
  })

  describe("projectInstructions option", () => {
    test("omitted when the list is empty", () => {
      expect(buildKannaSystemPromptAppend([], { projectInstructions: [] }))
        .toBe(KANNA_SYSTEM_PROMPT_BASE)
    })

    test("renders one titled block per entry, in order", () => {
      const out = buildKannaSystemPromptAppend([], {
        projectInstructions: [
          { projectId: "p1", projectTitle: "Backend API", instructions: "never edit generated/" },
          { projectId: "p2", projectTitle: "Web Client", instructions: "run pnpm gen" },
        ],
      })
      expect(out).toContain("## Project instructions \u2014 Backend API")
      expect(out).toContain("never edit generated/")
      expect(out).toContain("## Project instructions \u2014 Web Client")
      expect(out).toContain("run pnpm gen")
      expect(out.indexOf("Backend API")).toBeLessThan(out.indexOf("Web Client"))
    })

    // Broad to narrow: workspace rules, then how the projects relate, then
    // each project's own rules, then the paths those names map to.
    test("ordering is BASE, workspace, stack, per-project, roots, roster", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent({ name: "rev" })], {
        globalPromptAppend: "Always TDD.",
        stackInstructions: "api is upstream",
        projectInstructions: [
          { projectId: "p1", projectTitle: "Backend API", instructions: "never edit generated/" },
        ],
        stackProjects: [fakeBinding()],
      })
      const order = [
        "## Workspace instructions",
        "## Stack instructions",
        "## Project instructions \u2014 Backend API",
        "## Stack projects",
        "## Available subagents",
      ].map((h) => out.indexOf(h))
      expect(order.every((i) => i > -1)).toBe(true)
      expect([...order].sort((a, b) => a - b)).toEqual(order)
      expect(out.startsWith(KANNA_SYSTEM_PROMPT_BASE)).toBe(true)
    })
  })

  test("KANNA_SYSTEM_PROMPT_BASE includes preview_file proactivity nudge", () => {
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("mcp__kanna__preview_file")
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("pasting or summarizing its content")
  })

  // Kanna auto-repairs `-.x` at render time, but a repaired diagram still
  // carries a correction notice the reader has to reconcile — the prompt is
  // what stops the defect being written in the first place.
  test("KANNA_SYSTEM_PROMPT_BASE names the mermaid link spellings that parse", () => {
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("`-.-x` and `-.-o`")
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("never `-.x` / `-.o`")
  })

  test("KANNA_SYSTEM_PROMPT_BASE includes the workflow-resume args guardrail", () => {
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("resumeFromRunId")
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("`args`")
    expect(KANNA_SYSTEM_PROMPT_BASE).toContain("verbatim")
  })

  describe("stackProjects option", () => {
    test("returns BASE fast-path when stackProjects empty and nothing else set", () => {
      expect(buildKannaSystemPromptAppend([], { stackProjects: [] })).toBe(KANNA_SYSTEM_PROMPT_BASE)
    })

    test("omits the block when option absent", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent()])
      expect(out).not.toContain("## Stack projects")
    })

    test("renders title, role, and worktree path per binding", () => {
      const out = buildKannaSystemPromptAppend([], {
        stackProjects: [
          fakeBinding({ projectTitle: "Backend API", role: "primary", worktreePath: "/work/be" }),
          fakeBinding({ projectId: "p2", projectTitle: "Web Client", role: "additional", worktreePath: "/work/fe" }),
        ],
      })
      expect(out).toContain("## Stack projects")
      expect(out).toContain("- Backend API [primary]: /work/be")
      expect(out).toContain("- Web Client [additional]: /work/fe")
    })

    test("appends '(missing)' for a missing project status", () => {
      const out = buildKannaSystemPromptAppend([], {
        stackProjects: [fakeBinding({ projectTitle: "(missing)", projectStatus: "missing", worktreePath: "/work/gone" })],
      })
      expect(out).toContain("- (missing) [primary]: /work/gone (missing)")
    })

    test("places the block after Workspace instructions and before the subagent roster", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent({ name: "rev" })], {
        globalPromptAppend: "Always TDD.",
        stackProjects: [fakeBinding()],
      })
      const instrIdx = out.indexOf("## Workspace instructions")
      const stackIdx = out.indexOf("## Stack projects")
      const rosterIdx = out.indexOf("## Available subagents")
      expect(instrIdx).toBeGreaterThan(-1)
      expect(stackIdx).toBeGreaterThan(instrIdx)
      expect(rosterIdx).toBeGreaterThan(stackIdx)
    })

    test("BASE remains the first paragraph when only stackProjects set", () => {
      const out = buildKannaSystemPromptAppend([], { stackProjects: [fakeBinding()] })
      expect(out.startsWith(KANNA_SYSTEM_PROMPT_BASE)).toBe(true)
    })
  })

  describe("triggerMode roster split", () => {
    test("manual subagents render in a separate gated section", () => {
      const out = buildKannaSystemPromptAppend([
        fakeSubagent({ id: "a", name: "autoone", triggerMode: "auto" }),
        fakeSubagent({ id: "m", name: "manualone", triggerMode: "manual" }),
      ])
      expect(out).toContain("## Available subagents")
      expect(out).toContain("- autoone [id=a]")
      expect(out).toContain("## Manual subagents")
      expect(out).toContain("- manualone [id=m]")
      const autoSection = out.split("## Manual subagents")[0]
      expect(autoSection).not.toContain("manualone")
    })

    test("no manual section when all subagents are auto", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent({ triggerMode: "auto" })])
      expect(out).not.toContain("## Manual subagents")
    })

    test("no auto section when all subagents are manual", () => {
      const out = buildKannaSystemPromptAppend([fakeSubagent({ id: "m", name: "m1", triggerMode: "manual" })])
      expect(out).not.toContain("## Available subagents")
      expect(out).toContain("## Manual subagents")
    })
  })
})

// ---------------------------------------------------------------------------
// buildCodexDeveloperInstructions
// ---------------------------------------------------------------------------

/**
 * Codex used to receive `globalPromptAppend` and nothing else, so switching a
 * stack chat's provider silently downgraded it to a single-project chat — no
 * refusal, no UI signal, and the model simply unaware the peer roots existed.
 */
describe("buildCodexDeveloperInstructions", () => {
  test("returns undefined when there is nothing to say", () => {
    expect(buildCodexDeveloperInstructions({})).toBeUndefined()
    expect(buildCodexDeveloperInstructions({ globalPromptAppend: "   ", stackProjects: [] }))
      .toBeUndefined()
  })

  // Headed, not raw: with workspace / stack / per-project instructions all
  // possible, an unlabelled blob next to labelled blocks would be ambiguous
  // about which scope it came from. Same headings as the Claude suffix.
  test("heads the global prompt as Workspace instructions", () => {
    expect(buildCodexDeveloperInstructions({ globalPromptAppend: "Always TDD." }))
      .toBe("## Workspace instructions\n\nAlways TDD.")
  })

  test("carries the stack and per-project blocks too", () => {
    const out = buildCodexDeveloperInstructions({
      stackInstructions: "api is upstream of web",
      projectInstructions: [
        { projectId: "p1", projectTitle: "Backend API", instructions: "never edit generated/" },
      ],
    }) ?? ""
    expect(out).toContain("## Stack instructions")
    expect(out).toContain("api is upstream of web")
    expect(out).toContain("## Project instructions — Backend API")
    expect(out).toContain("never edit generated/")
  })

  test("carries the same stack block the Claude prompt uses", () => {
    const out = buildCodexDeveloperInstructions({
      stackProjects: [
        fakeBinding({ projectTitle: "Backend API", role: "primary", worktreePath: "/work/be" }),
        fakeBinding({ projectId: "p2", projectTitle: "Web Client", role: "additional", worktreePath: "/work/fe" }),
      ],
    })
    expect(out).toContain("## Stack projects")
    expect(out).toContain("- Backend API [primary]: /work/be")
    expect(out).toContain("- Web Client [additional]: /work/fe")
  })

  test("the global prompt comes first, then the stack block", () => {
    const out = buildCodexDeveloperInstructions({
      globalPromptAppend: "Always TDD.",
      stackProjects: [fakeBinding()],
    }) ?? ""
    expect(out.indexOf("Always TDD.")).toBeLessThan(out.indexOf("## Stack projects"))
  })

  // Kanna starts every Codex thread with `approvalPolicy: "never"` and
  // `sandbox: "danger-full-access"` (codex-app-server.ts), so a peer root IS
  // reachable — what Codex lacked was knowledge of it, not permission. The
  // note must say that and not promise a workspace it does not have.
  test("tells Codex its cwd is the primary but peer roots are reachable", () => {
    const out = buildCodexDeveloperInstructions({
      stackProjects: [
        fakeBinding({ projectTitle: "Backend API", role: "primary" }),
        fakeBinding({ projectId: "p2", role: "additional", worktreePath: "/work/fe" }),
      ],
    }) ?? ""
    expect(out).toContain("absolute path")
    expect(out).not.toContain("grantRoot")
  })

  // A lone primary is not a cross-root situation, so the caveat would be noise.
  test("omits the reach note when there is only one root", () => {
    const out = buildCodexDeveloperInstructions({ stackProjects: [fakeBinding()] }) ?? ""
    expect(out).toContain("## Stack projects")
    expect(out).not.toContain("absolute path")
  })
})
