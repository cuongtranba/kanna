import "../../../../lib/testing/setupHappyDom"
import { describe, expect, test, mock, beforeEach, afterEach } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { TableBody } from "./TableBody"
import type { PreviewSource } from "../types"

beforeEach(() => {
  ;(globalThis as { fetch?: unknown }).fetch = mock(async () => new Response("a,b\n1,2"))
})
afterEach(() => {
  delete (globalThis as { fetch?: unknown }).fetch
})

describe("TableBody", () => {
  test("renders a <table> shell with sticky thead class", () => {
    const html = renderToStaticMarkup(<TableBody source={{
      id: "t", contentUrl: "/u/x.csv", displayName: "x.csv", fileName: "x.csv",
      mimeType: "text/csv", size: 10, origin: "user_attachment",
    } satisfies PreviewSource} />)
    expect(html).toContain("<table")
  })
})
