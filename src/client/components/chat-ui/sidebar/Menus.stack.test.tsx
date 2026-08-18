import { describe, expect, test } from "bun:test"
import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { StackActionsPopover, StackSectionMenu } from "./Menus"

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

  test("StackSectionMenu accepts an optional onOpenBoards callback without throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(StackSectionMenu, {
          stackTitle: "Another Stack",
          onOpenBoards: () => undefined,
          onRename: () => undefined,
          onEditMembers: () => undefined,
          onDelete: () => undefined,
          children: createElement("div", null, "trigger"),
        })
      )
    ).not.toThrow()
  })

  test("StackSectionMenu renders fine with onOpenBoards omitted", () => {
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

describe("StackActionsPopover", () => {
  test("renders children inside trigger", () => {
    const html = renderToStaticMarkup(
      createElement(StackActionsPopover, {
        stackTitle: "My Stack",
        onRename: () => undefined,
        onEditMembers: () => undefined,
        onDelete: () => undefined,
        children: createElement("button", null, "Stack actions"),
      })
    )

    expect(html).toContain("Stack actions")
  })

  test("accepts an optional onOpenBoards callback without throwing", () => {
    expect(() =>
      renderToStaticMarkup(
        createElement(StackActionsPopover, {
          stackTitle: "My Stack",
          onOpenBoards: () => undefined,
          onRename: () => undefined,
          onEditMembers: () => undefined,
          onDelete: () => undefined,
          children: createElement("button", null, "Stack actions"),
        })
      )
    ).not.toThrow()
  })
})
