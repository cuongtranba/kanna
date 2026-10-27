import { describe, expect, test } from "bun:test"
import { classifyGitFailure, createSyncFailure } from "./diff-store-errors"

describe("classifyGitFailure", () => {
  test("names remote authentication failures once for every remote context", () => {
    for (const context of ["push", "pull", "fetch", "publish"] as const) {
      const failure = classifyGitFailure("fatal: Authentication failed for 'https://x'", context, "fallback")
      expect(failure.title).toBe("Remote authentication failed")
    }
  })

  test("does not treat a commit failure as a remote failure", () => {
    const failure = classifyGitFailure("fatal: Authentication failed", "commit", "Git could not create the commit.")
    expect(failure).toEqual({ title: "Commit failed", message: "fatal: Authentication failed" })
  })

  test("explains a non-fast-forward push", () => {
    expect(classifyGitFailure("! [rejected] main -> main (non-fast-forward)", "push", "fallback").title)
      .toBe("Branch is not up to date")
  })

  test("only a pull is told to rebase when it cannot fast-forward", () => {
    expect(classifyGitFailure("fatal: Not possible to fast-forward, aborting.", "pull", "fallback").title)
      .toBe("Pull requires merge or rebase")
    expect(classifyGitFailure("fatal: Not possible to fast-forward, aborting.", "fetch", "fallback").title)
      .toBe("Fetch failed")
  })

  test("falls back to the first line of the detail, then to the caller's message", () => {
    expect(classifyGitFailure("boom\nmore", "publish", "fallback")).toEqual({
      title: "Publish branch failed",
      message: "boom",
    })
    expect(classifyGitFailure("", "publish", "fallback").message).toBe("fallback")
  })
})

describe("createSyncFailure", () => {
  test("carries the action, the detail and the snapshot flag", () => {
    expect(createSyncFailure("pull", "fatal: Not possible to fast-forward", false)).toEqual({
      ok: false,
      action: "pull",
      title: "Pull requires merge or rebase",
      message: "Your branch cannot be fast-forwarded. Rebase or merge manually, then try again.",
      detail: "fatal: Not possible to fast-forward",
      snapshotChanged: false,
    })
  })
})
