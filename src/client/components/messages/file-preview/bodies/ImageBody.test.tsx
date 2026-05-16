import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ImageBody } from "./ImageBody"
import type { PreviewSource } from "../types"

const SRC: PreviewSource = {
  id: "i", contentUrl: "/u/a.png", displayName: "a.png", fileName: "a.png",
  mimeType: "image/png", size: 1, origin: "user_attachment",
}

describe("ImageBody", () => {
  test("renders <img> with contentUrl, alt=displayName, pinch-zoom touch-action, object-contain", () => {
    const html = renderToStaticMarkup(<ImageBody source={SRC} />)
    expect(html).toContain('src="/u/a.png"')
    expect(html).toContain('alt="a.png"')
    expect(html).toContain("object-contain")
    expect(html).toContain("touch-action")
  })
})
