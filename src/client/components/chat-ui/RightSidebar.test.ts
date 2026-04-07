import { describe, expect, mock, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { RightSidebar, canIgnoreDiffFile } from "./RightSidebar"
import { TooltipProvider } from "../ui/tooltip"

describe("RightSidebar", () => {
  test("renders the empty-state copy", () => {
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(RightSidebar, {
        projectId: "project-1",
        diffs: { status: "unknown", files: [] },
        editorLabel: "Cursor",
        diffRenderMode: "unified",
        wrapLines: false,
        onOpenFile: () => {},
        onDiscardFile: () => {},
        onIgnoreFile: () => {},
        onCopyFilePath: () => {},
        onCopyRelativePath: () => {},
        onGenerateCommitMessage: async () => ({ subject: "", body: "" }),
        onCommit: async () => null,
        onDiffRenderModeChange: () => {},
        onWrapLinesChange: () => {},
        onClose: () => {},
      })
    ))

    expect(markup).toContain("No file changes.")
  })

  test("renders the close affordance", () => {
    const onClose = mock(() => {})
    const markup = renderToStaticMarkup(createElement(
      TooltipProvider,
      null,
      createElement(RightSidebar, {
        projectId: "project-1",
        diffs: { status: "unknown", files: [] },
        editorLabel: "Cursor",
        diffRenderMode: "unified",
        wrapLines: false,
        onOpenFile: () => {},
        onDiscardFile: () => {},
        onIgnoreFile: () => {},
        onCopyFilePath: () => {},
        onCopyRelativePath: () => {},
        onGenerateCommitMessage: async () => ({ subject: "", body: "" }),
        onCommit: async () => null,
        onDiffRenderModeChange: () => {},
        onWrapLinesChange: () => {},
        onClose,
      })
    ))

    expect(markup).toContain("Close right sidebar")
  })

  test("ignores only untracked files", () => {
    expect(canIgnoreDiffFile({
      path: "tmp.log",
      changeType: "added",
      isUntracked: true,
      patch: "",
    })).toBe(true)

    expect(canIgnoreDiffFile({
      path: "src/app.ts",
      changeType: "modified",
      isUntracked: false,
      patch: "",
    })).toBe(false)
  })
})
