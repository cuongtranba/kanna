import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { act } from "react"
import { createRoot } from "react-dom/client"
import "../../lib/testing/setupHappyDom"
import { TooltipProvider } from "../ui/tooltip"
import { ShareButton } from "./ShareButton"

function renderHtml(props: { chatId: string }): string {
  return renderToStaticMarkup(
    createElement(TooltipProvider, null,
      createElement(ShareButton, { ...props, onOpenPopover: () => {} }),
    ),
  )
}

describe("ShareButton", () => {
  test("renders Share label and is always enabled", () => {
    const html = renderHtml({ chatId: "c1" })
    expect(html).toContain("aria-label=\"Public link\"")
    expect(html).not.toContain("disabled=\"\"")
  })

  test("click calls onOpenPopover with chatId", async () => {
    const calls: string[] = []
    const container = document.createElement("div")
    document.body.appendChild(container)
    try {
      await act(async () => {
        const root = createRoot(container)
        root.render(
          createElement(TooltipProvider, null,
            createElement(ShareButton, {
              chatId: "c1",
              onOpenPopover: (id: string) => { calls.push(id) },
            }),
          ),
        )
      })
      const btn = container.querySelector("button[aria-label='Public link']") as HTMLButtonElement
      expect(btn).not.toBeNull()
      await act(async () => {
        btn.click()
      })
      expect(calls).toEqual(["c1"])
    } finally {
      container.remove()
    }
  })
})
