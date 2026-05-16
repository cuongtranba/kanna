import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { StackSectionMenu } from "./Menus"

describe("StackSectionMenu", () => {
  test("StackSectionMenu renders children inside trigger", () => {
    const html = renderToStaticMarkup(
      createElement(StackSectionMenu, {
        stackTitle: "My Stack",
        onRename: () => undefined,
        onEditMembers: () => undefined,
        onDelete: () => undefined,
        children: createElement("button", null, "Stack row"),
      })
    )

    expect(html).toContain("Stack row")
  })

  test("StackSectionMenu renders without errors when all props provided", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(StackSectionMenu, {
          stackTitle: "My Stack",
          onRename: () => undefined,
          onEditMembers: () => undefined,
          onDelete: () => undefined,
          children: createElement("button", null, "Stack row"),
        })
      )
    ).not.toThrow()
  })

  test("StackSectionMenu accepts onRename, onEditMembers, onDelete callbacks", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(StackSectionMenu, {
          stackTitle: "Another Stack",
          onRename: () => undefined,
          onEditMembers: () => undefined,
          onDelete: () => undefined,
          children: createElement("div", null, "trigger"),
        })
      )
    ).not.toThrow()
  })
})
