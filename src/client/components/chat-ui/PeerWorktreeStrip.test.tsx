import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { describe, expect, test } from "bun:test"
import { PeerWorktreeStrip } from "./PeerWorktreeStrip"
import type { ResolvedStackBinding } from "../../../shared/types"

const makeBinding = (overrides: Partial<ResolvedStackBinding> = {}): ResolvedStackBinding => ({
  projectId: "proj-1",
  projectTitle: "My Project",
  worktreePath: "/home/user/project",
  role: "primary",
  projectStatus: "active",
  ...overrides,
})

describe("PeerWorktreeStrip", () => {
  test("renders nothing when bindings has 0 entries", () => {
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, { bindings: [], provider: null, onOpenPath: () => undefined })
    )
    expect(html).toBe("")
  })

  test("renders nothing when bindings has exactly 1 entry", () => {
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, {
        bindings: [makeBinding()],
        provider: null,
        onOpenPath: () => undefined,
      })
    )
    expect(html).toBe("")
  })

  test("renders basename labels for each binding when 2+ entries", () => {
    const bindings: ResolvedStackBinding[] = [
      makeBinding({ worktreePath: "/home/user/backend", role: "primary" }),
      makeBinding({ worktreePath: "/home/user/frontend", role: "additional" }),
    ]
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, { bindings, provider: null, onOpenPath: () => undefined })
    )
    expect(html).toContain("backend")
    expect(html).toContain("frontend")
  })

  test("primary binding shows filled dot (●), additional shows open circle (○)", () => {
    const bindings: ResolvedStackBinding[] = [
      makeBinding({ worktreePath: "/home/user/backend", role: "primary" }),
      makeBinding({ worktreePath: "/home/user/frontend", role: "additional" }),
    ]
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, { bindings, provider: null, onOpenPath: () => undefined })
    )
    expect(html).toContain("●")
    expect(html).toContain("○")
  })

  test("missing peer binding renders with line-through class", () => {
    const bindings: ResolvedStackBinding[] = [
      makeBinding({ worktreePath: "/home/user/backend", role: "primary" }),
      makeBinding({ worktreePath: "/home/user/missing-proj", role: "additional", projectStatus: "missing" }),
    ]
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, { bindings, provider: null, onOpenPath: () => undefined })
    )
    expect(html).toContain("line-through")
  })

  test("codex provider shows 'codex: cwd-only' label", () => {
    const bindings: ResolvedStackBinding[] = [
      makeBinding({ worktreePath: "/home/user/backend", role: "primary" }),
      makeBinding({ worktreePath: "/home/user/frontend", role: "additional" }),
    ]
    const html = renderToStaticMarkup(
      createElement(PeerWorktreeStrip, { bindings, provider: "codex", onOpenPath: () => undefined })
    )
    expect(html).toContain("codex: cwd-only")
  })
})
