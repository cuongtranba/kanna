import { describe, expect, test } from "bun:test"
import {
  BLOCKED_BY,
  blockersOf,
  buildBlockerGraph,
  describeBlockedByCycle,
  describeBlockedReason,
  findBlockerCycle,
} from "./dependencies"
import type { CardLink } from "./types"

function link(cardId: string, targetId: string, kind: CardLink["kind"] = BLOCKED_BY): CardLink {
  return { cardId, kind, targetId, createdAt: 0 }
}

describe("buildBlockerGraph", () => {
  test("keeps only blocked_by links", () => {
    const graph = buildBlockerGraph([
      link("a", "b"),
      link("a", "chat-1", "chat"),
      link("a", "/wt/a", "worktree"),
    ])
    expect(blockersOf(graph, "a")).toEqual(["b"])
  })

  test("a card with no edges has no blockers", () => {
    expect(blockersOf(buildBlockerGraph([]), "a")).toEqual([])
  })

  test("collects several blockers on one card, in link order", () => {
    const graph = buildBlockerGraph([link("a", "b"), link("a", "c")])
    expect(blockersOf(graph, "a")).toEqual(["b", "c"])
  })
})

describe("findBlockerCycle", () => {
  test("a first edge between two free cards is safe", () => {
    expect(findBlockerCycle(buildBlockerGraph([]), "a", "b")).toBeNull()
  })

  test("a self-edge is the shortest cycle", () => {
    expect(findBlockerCycle(buildBlockerGraph([]), "a", "a")).toEqual(["a", "a"])
  })

  test("names the two-card cycle it would close", () => {
    // b already waits on a, so a waiting on b closes the loop.
    const graph = buildBlockerGraph([link("b", "a")])
    expect(findBlockerCycle(graph, "a", "b")).toEqual(["a", "b", "a"])
  })

  test("names the whole path of a longer cycle", () => {
    const graph = buildBlockerGraph([link("b", "c"), link("c", "a")])
    expect(findBlockerCycle(graph, "a", "b")).toEqual(["a", "b", "c", "a"])
  })

  test("a diamond is not a cycle", () => {
    // d waits on b and c, both of which wait on a. Adding a second path to a
    // shared ancestor must stay legal — this is a DAG, not a tree.
    const graph = buildBlockerGraph([link("d", "b"), link("b", "a"), link("c", "a")])
    expect(findBlockerCycle(graph, "d", "c")).toBeNull()
  })

  test("terminates on a graph that already holds a cycle", () => {
    // Defensive: a database edited by hand could hold one. The walk must not
    // hang, and an unrelated edge must still be judged on its own merits.
    const graph = buildBlockerGraph([link("x", "y"), link("y", "x")])
    expect(findBlockerCycle(graph, "a", "x")).toBeNull()
  })
})

describe("describeBlockedByCycle", () => {
  test("renders the path with titles", () => {
    const titles = new Map([
      ["a", "Ship the API"],
      ["b", "Regenerate the client"],
    ])
    expect(describeBlockedByCycle(["a", "b", "a"], (id) => titles.get(id) ?? id)).toBe(
      '"Ship the API" → "Regenerate the client" → "Ship the API"',
    )
  })

  test("falls back to the id when a title is unknown", () => {
    expect(describeBlockedByCycle(["a", "a"], () => null)).toBe('"a" → "a"')
  })
})

describe("describeBlockedReason", () => {
  test("names a single blocker", () => {
    expect(describeBlockedReason(["Ship the API"])).toBe('Waiting on "Ship the API".')
  })

  test("names two blockers", () => {
    expect(describeBlockedReason(["Ship the API", "Migrate the schema"])).toBe(
      'Waiting on "Ship the API" and "Migrate the schema".',
    )
  })

  test("names three or more with commas", () => {
    expect(describeBlockedReason(["A", "B", "C"])).toBe('Waiting on "A", "B" and "C".')
  })

  test("no blockers is not a reason", () => {
    expect(describeBlockedReason([])).toBeNull()
  })
})
