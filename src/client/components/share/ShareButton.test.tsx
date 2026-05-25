import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { ShareButton } from "./ShareButton"

describe("ShareButton", () => {
  test("renders Public link label and is enabled by default", () => {
    const html = renderToStaticMarkup(createElement(ShareButton))
    expect(html).toContain("aria-label=\"Public link\"")
    expect(html).not.toContain("disabled=\"\"")
  })

  test("click invokes onClick handler", async () => {
    const calls: string[] = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    try {
      await act(async () => {
        const root = createRoot(container)
        root.render(
          createElement(ShareButton, {
            onClick: () => { calls.push("clicked") },
          }),
        )
      })
      const btn = container.querySelector("button[aria-label='Public link']") as HTMLButtonElement
      expect(btn).not.toBeNull()
      await act(async () => {
        btn.click()
      })
      expect(calls).toEqual(["clicked"])
    } finally {
      container.remove()
    }
  })
})
