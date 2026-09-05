import { describe, expect, test } from "bun:test"
import { renderForLoopCheck } from "../../lib/testing/renderForLoopCheck"
import { ImageViewMessage } from "./ImageViewMessage"

describe("ImageViewMessage", () => {
  test("renders the image from its content URL and defers the bytes to the browser", async () => {
    const r = await renderForLoopCheck(
      <ImageViewMessage
        toolId="iv-1"
        path="/home/me/proj/assets/shot.png"
        contentUrl="/api/local-file?path=%2Fhome%2Fme%2Fproj%2Fassets%2Fshot.png"
        mimeType="image/png"
      />,
    )
    try {
      expect(r.loopWarnings).toEqual([])
      expect(r.thrown).toBeNull()
      const img = document.body.querySelector("img")
      expect(img).not.toBeNull()
      expect(img?.getAttribute("src")).toBe("/api/local-file?path=%2Fhome%2Fme%2Fproj%2Fassets%2Fshot.png")
      expect(img?.getAttribute("loading")).toBe("lazy")
      expect(img?.getAttribute("alt")).toBe("shot.png")
    } finally {
      await r.cleanup()
    }
  })

  test("falls back to the path when no content URL could be built", async () => {
    const r = await renderForLoopCheck(
      <ImageViewMessage toolId="iv-2" path="assets/shot.png" contentUrl="" mimeType="image/png" />,
    )
    try {
      expect(r.thrown).toBeNull()
      expect(document.body.querySelector("img")).toBeNull()
      expect(document.body.textContent ?? "").toContain("assets/shot.png")
    } finally {
      await r.cleanup()
    }
  })
})
