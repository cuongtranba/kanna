import "../../../lib/testing/setupHappyDom"
import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../../lib/testing/renderForLoopCheck"
import { FilePreviewSheet } from "./FilePreviewSheet"
import type { PreviewSource } from "./types"

const SRC: PreviewSource = {
  id: "s", contentUrl: "/u/x.txt", displayName: "x.txt", fileName: "x.txt",
  mimeType: "text/plain", size: 10, origin: "user_attachment",
}

describe("FilePreviewSheet loop safety", () => {
  test("does not trigger Maximum update depth warnings on mount", async () => {
    const result = await renderForLoopCheck(<FilePreviewSheet source={SRC} open onOpenChange={() => {}} />)
    expect(result.loopWarnings).toEqual([])
    await result.cleanup()
  })
})
