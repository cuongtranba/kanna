import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { AudioBody } from "./AudioBody"
import { VideoBody } from "./VideoBody"
import type { PreviewSource } from "../types"

const mkSrc = (mime: string, name: string): PreviewSource => ({
  id: name, contentUrl: "/u/" + name, displayName: name, fileName: name,
  mimeType: mime, size: 1, origin: "user_attachment",
})

describe("AudioBody", () => {
  test("renders <audio controls preload=metadata>", () => {
    const html = renderToStaticMarkup(<AudioBody source={mkSrc("audio/mpeg", "a.mp3")} />)
    expect(html).toContain("<audio")
    expect(html).toContain("controls")
    expect(html).toMatch(/preload="metadata"/)
  })
})

describe("VideoBody", () => {
  test("renders <video controls playsInline preload=metadata>", () => {
    const html = renderToStaticMarkup(<VideoBody source={mkSrc("video/mp4", "v.mp4")} />)
    expect(html).toContain("<video")
    expect(html).toContain("controls")
    expect(html).toMatch(/playsInline|playsinline/i)
    expect(html).toMatch(/preload="metadata"/)
  })
})
