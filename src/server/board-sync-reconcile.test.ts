import { describe, expect, test } from "bun:test"
import {
  advanceWatermarks,
  reconcileItem,
  watermarksAfterPush,
  type LocalCardState,
  type SyncLinkState,
} from "./board-sync-reconcile"
import type { RemoteItem } from "../shared/boards/sync-types"

const T0 = 1_700_000_000_000
const MINUTE = 60_000

function remote(overrides: Partial<RemoteItem> = {}): RemoteItem {
  return {
    externalId: "412",
    url: "https://github.com/o/r/issues/412",
    title: "Fix: login redirect loop",
    body: "Steps to reproduce",
    state: "open",
    labels: ["auth", "bug"],
    assignee: null,
    updatedAt: T0,
    ...overrides,
  }
}

function local(overrides: Partial<LocalCardState> = {}): LocalCardState {
  return {
    cardId: "card-1",
    title: "Fix: login redirect loop",
    body: "Steps to reproduce",
    state: "open",
    labels: ["auth", "bug"],
    assignee: null,
    updatedAt: T0,
    ...overrides,
  }
}

function link(overrides: Partial<SyncLinkState> = {}): SyncLinkState {
  return {
    fieldWatermarks: { title: T0, body: T0, state: T0, labels: T0, assignee: T0 },
    lastSyncedAt: T0,
    ...overrides,
  }
}

describe("reconcileItem", () => {
  test("an unseen remote item is a create", () => {
    expect(reconcileItem({ remote: remote(), local: null, link: null })).toEqual({
      kind: "create",
      remote: remote(),
    })
  })

  test("identical sides are unchanged", () => {
    expect(reconcileItem({ remote: remote(), local: local(), link: link() })).toEqual({
      kind: "unchanged",
      cardId: "card-1",
    })
  })

  test("a remote-only edit is taken", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Fix: login loop", updatedAt: T0 + MINUTE }),
      local: local(),
      link: link(),
    })
    expect(decision).toEqual({ kind: "apply", cardId: "card-1", take: ["title"], keep: [], conflicts: [] })
  })

  test("a local-only edit is kept, and queued rather than overwritten", () => {
    const decision = reconcileItem({
      remote: remote(),
      local: local({ title: "Fix: login loop (ours)", updatedAt: T0 + MINUTE }),
      link: link(),
    })
    expect(decision).toEqual({ kind: "apply", cardId: "card-1", take: [], keep: ["title"], conflicts: [] })
  })

  test("both sides changed and the remote is newer: remote wins, conflict recorded", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Remote title", updatedAt: T0 + 2 * MINUTE }),
      local: local({ title: "Local title", updatedAt: T0 + MINUTE }),
      link: link(),
    })
    expect(decision).toEqual({
      kind: "apply",
      cardId: "card-1",
      take: ["title"],
      keep: [],
      conflicts: [{ field: "title", resolvedAs: "remote" }],
    })
  })

  test("both sides changed and the local is newer: local wins, conflict recorded", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Remote title", updatedAt: T0 + MINUTE }),
      local: local({ title: "Local title", updatedAt: T0 + 2 * MINUTE }),
      link: link(),
    })
    expect(decision).toEqual({
      kind: "apply",
      cardId: "card-1",
      take: [],
      keep: ["title"],
      conflicts: [{ field: "title", resolvedAs: "local" }],
    })
  })

  test("a remote touch that changed nothing is not an edit", () => {
    const decision = reconcileItem({
      remote: remote({ updatedAt: T0 + 10 * MINUTE }),
      local: local(),
      link: link(),
    })
    expect(decision).toEqual({ kind: "unchanged", cardId: "card-1" })
  })

  test("fields are judged independently", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Remote title", state: "closed", updatedAt: T0 + 2 * MINUTE }),
      local: local({ title: "Local title", updatedAt: T0 + MINUTE }),
      link: link(),
    })
    expect(decision).toEqual({
      kind: "apply",
      cardId: "card-1",
      take: ["title", "state"],
      keep: [],
      conflicts: [
        { field: "title", resolvedAs: "remote" },
        { field: "state", resolvedAs: "remote" },
      ],
    })
  })

  test("labels compare as a set, not as an order", () => {
    expect(
      reconcileItem({
        remote: remote({ labels: ["bug", "auth"], updatedAt: T0 + MINUTE }),
        local: local({ labels: ["auth", "bug"] }),
        link: link(),
      }),
    ).toEqual({ kind: "unchanged", cardId: "card-1" })
  })

  test("a field below its watermark is ignored even when the values differ", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Theirs", updatedAt: T0 }),
      local: local({ title: "Ours", updatedAt: T0 }),
      link: link({ fieldWatermarks: { ...link().fieldWatermarks, title: T0 + MINUTE } }),
    })
    expect(decision).toEqual({ kind: "unchanged", cardId: "card-1" })
  })

  test("a first sync with no link takes nothing it cannot justify", () => {
    const decision = reconcileItem({
      remote: remote({ title: "Remote title" }),
      local: local({ title: "Local title" }),
      link: null,
    })
    expect(decision).toEqual({ kind: "apply", cardId: "card-1", take: ["title"], keep: [], conflicts: [] })
  })
})

describe("watermarks", () => {
  test("taken fields advance, kept fields do not", () => {
    const next = advanceWatermarks({ title: T0, state: T0 }, remote({ updatedAt: T0 + MINUTE }), ["title"])
    expect(next).toEqual({ title: T0 + MINUTE, state: T0 })
  })

  test("a successful push stamps the remote timestamp our write produced", () => {
    expect(watermarksAfterPush({ title: T0 }, T0 + 5 * MINUTE, ["title", "state"])).toEqual({
      title: T0 + 5 * MINUTE,
      state: T0 + 5 * MINUTE,
    })
  })

  test("a push watermark makes the very next reconcile a no-op", () => {
    const pushed = remote({ title: "Ours", updatedAt: T0 + 5 * MINUTE })
    const marks = watermarksAfterPush(link().fieldWatermarks, pushed.updatedAt, ["title"])
    expect(
      reconcileItem({
        remote: pushed,
        local: local({ title: "Ours", updatedAt: T0 + MINUTE }),
        link: { fieldWatermarks: marks, lastSyncedAt: T0 + 5 * MINUTE },
      }),
    ).toEqual({ kind: "unchanged", cardId: "card-1" })
  })
})
