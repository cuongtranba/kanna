import { describe, expect, test } from "vite-plus/test"
import { makeFakeDomPort } from "../adapters/testing/makeFakePorts"
import { openContextMenuFromButton } from "./openContextMenuFromButton"

function setup() {
  const dom = makeFakeDomPort()
  const flags = { prevented: false, stopped: false }
  const button = document.createElement("button")
  button.getBoundingClientRect = () => new DOMRect(100, 40, 20, 10)
  const event = {
    currentTarget: button,
    preventDefault: () => {
      flags.prevented = true
    },
    stopPropagation: () => {
      flags.stopped = true
    },
  }
  return { dom, button, event, flags }
}

describe("openContextMenuFromButton", () => {
  test("opens the button's own context menu at the bottom centre of the button", () => {
    const { dom, button, event, flags } = setup()
    openContextMenuFromButton(event, dom)
    expect(flags).toEqual({ prevented: true, stopped: true })
    expect(dom.contextMenuEventCalls).toEqual([{ target: button, clientX: 110, clientY: 50 }])
  })

  test("dispatches on another element while anchoring to the button", () => {
    const { dom, event } = setup()
    const card = document.createElement("div")
    openContextMenuFromButton(event, dom, card)
    expect(dom.contextMenuEventCalls).toEqual([{ target: card, clientX: 110, clientY: 50 }])
  })

  test("dispatches nothing when the target is missing", () => {
    const { dom, event, flags } = setup()
    openContextMenuFromButton(event, dom, null)
    expect(flags.prevented).toBe(true)
    expect(dom.contextMenuEventCalls).toEqual([])
  })
})
