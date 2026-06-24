/**
 * Tests for lexicalToReact.tsx — verifies that renderMarkdownToReact produces
 * the expected HTML tags and className strings for representative markdown inputs.
 *
 * Strategy: renderToStaticMarkup (matching the existing test pattern in this repo)
 * on a wrapper element to assert tag presence / class presence.
 */
import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { renderMarkdownToReact } from "./lexicalToReact"

function render(markdown: string): string {
  return renderToStaticMarkup(
    <div>{renderMarkdownToReact(markdown)}</div>
  )
}

describe("renderMarkdownToReact", () => {
  // ---- Headings ------------------------------------------------------------

  test("renders h1 with correct class", () => {
    const html = render("# Hello")
    expect(html).toContain("<h1")
    expect(html).toContain("text-[20px]")
    expect(html).toContain("font-normal")
    expect(html).toContain("Hello")
  })

  test("renders h2 with correct class", () => {
    const html = render("## World")
    expect(html).toContain("<h2")
    expect(html).toContain("text-[18px]")
    expect(html).toContain("World")
  })

  test("renders h3 with correct class", () => {
    const html = render("### Sub")
    expect(html).toContain("<h3")
    expect(html).toContain("text-[16px]")
    expect(html).toContain("Sub")
  })

  test("renders h4 through h6 with same class as h3", () => {
    const h4 = render("#### Four")
    expect(h4).toContain("<h4")
    expect(h4).toContain("text-[16px]")

    const h5 = render("##### Five")
    expect(h5).toContain("<h5")

    const h6 = render("###### Six")
    expect(h6).toContain("<h6")
  })

  // ---- Paragraph -----------------------------------------------------------

  test("renders paragraph with break-words class", () => {
    const html = render("Just a plain paragraph.")
    expect(html).toContain("<p")
    expect(html).toContain("break-words")
    expect(html).toContain("Just a plain paragraph.")
  })

  // ---- Blockquote ----------------------------------------------------------

  test("renders blockquote with border-l-2 class", () => {
    const html = render("> A quoted line")
    expect(html).toContain("<blockquote")
    expect(html).toContain("border-l-2")
    expect(html).toContain("pl-2")
    expect(html).toContain("A quoted line")
  })

  // ---- Inline text formats -------------------------------------------------

  test("renders bold as <strong> with font-semibold", () => {
    const html = render("This is **bold** text")
    expect(html).toContain("<strong")
    expect(html).toContain("font-semibold")
    expect(html).toContain("bold")
  })

  test("renders italic as <em> with italic class", () => {
    const html = render("This is *italic* text")
    expect(html).toContain("<em")
    expect(html).toContain("italic")
  })

  test("renders strikethrough as <del> with line-through class", () => {
    const html = render("This is ~~struck~~ text")
    expect(html).toContain("<del")
    expect(html).toContain("line-through")
    expect(html).toContain("struck")
  })

  test("renders inline code as <code> with bg-border/60 class", () => {
    const html = render("Use `console.log()` here")
    expect(html).toContain("<code")
    expect(html).toContain("bg-border/60")
    expect(html).toContain("console.log()")
  })

  // ---- Code fence ----------------------------------------------------------

  test("renders fenced code block with <pre><code> and language class", () => {
    const md = "```typescript\nconst x = 1\n```"
    const html = render(md)
    expect(html).toContain("<pre")
    expect(html).toContain("<code")
    expect(html).toContain("language-typescript")
    expect(html).toContain("const x = 1")
  })

  test("renders fenced code block without language class when none specified", () => {
    const md = "```\nsome code\n```"
    const html = render(md)
    expect(html).toContain("<pre")
    expect(html).toContain("some code")
    expect(html).not.toContain("language-")
  })

  // ---- Link ----------------------------------------------------------------

  test("renders link as <a> with underline and target=_blank", () => {
    const html = render("[Example](https://example.com)")
    expect(html).toContain("<a")
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('target="_blank"')
    expect(html).toContain("underline")
    expect(html).toContain("Example")
  })

  // ---- Unordered list ------------------------------------------------------

  test("renders unordered list as <ul> with list-disc", () => {
    const html = render("- alpha\n- beta\n- gamma")
    expect(html).toContain("<ul")
    expect(html).toContain("list-disc")
    expect(html).toContain("<li")
    expect(html).toContain("alpha")
    expect(html).toContain("beta")
    expect(html).toContain("gamma")
  })

  // ---- Ordered list --------------------------------------------------------

  test("renders ordered list as <ol> with list-decimal", () => {
    const html = render("1. first\n2. second")
    expect(html).toContain("<ol")
    expect(html).toContain("list-decimal")
    expect(html).toContain("<li")
    expect(html).toContain("first")
    expect(html).toContain("second")
  })

  // ---- Task list -----------------------------------------------------------

  test("renders task list with checkboxes", () => {
    const html = render("- [x] Done\n- [ ] Pending")
    expect(html).toContain('<input type="checkbox"')
    expect(html).toContain("Done")
    expect(html).toContain("Pending")
  })

  test("checked task item has checked attribute", () => {
    const html = render("- [x] Done")
    // renderToStaticMarkup renders checked boolean prop as checked=""
    expect(html).toContain("checked")
    expect(html).toContain("Done")
  })

  // ---- GFM table -----------------------------------------------------------

  test("renders GFM table with <table>, <thead>, <tbody>", () => {
    const md = [
      "| Name   | Age |",
      "| ------ | --- |",
      "| Alice  | 30  |",
      "| Bob    | 25  |",
    ].join("\n")
    const html = render(md)
    expect(html).toContain("<table")
    expect(html).toContain("<thead")
    expect(html).toContain("<tbody")
    expect(html).toContain("<th")
    expect(html).toContain("<td")
    expect(html).toContain("Name")
    expect(html).toContain("Age")
    expect(html).toContain("Alice")
    expect(html).toContain("Bob")
  })

  test("table th has correct muted text classes", () => {
    const md = "| Col |\n| --- |\n| val |"
    const html = render(md)
    expect(html).toContain("<th")
    expect(html).toContain("text-muted-foreground")
    expect(html).toContain("uppercase")
  })

  test("table wrapper div has rounded-xl class", () => {
    const md = "| A |\n| - |\n| 1 |"
    const html = render(md)
    expect(html).toContain("rounded-xl")
    expect(html).toContain("border-border")
  })

  // ---- Mixed content -------------------------------------------------------

  test("renders mixed markdown: heading + paragraph + code fence", () => {
    const md = "# Heading\n\nA paragraph.\n\n```js\nconsole.log('hi')\n```"
    const html = render(md)
    expect(html).toContain("<h1")
    expect(html).toContain("Heading")
    expect(html).toContain("<p")
    expect(html).toContain("A paragraph.")
    expect(html).toContain("<pre")
    expect(html).toContain("console.log")
  })

  test("renders bold + italic combined (***text***)", () => {
    const html = render("***bold and italic***")
    expect(html).toContain("<strong")
    expect(html).toContain("<em")
  })

  // ---- Empty / edge cases --------------------------------------------------

  test("renders empty string without throwing", () => {
    expect(() => render("")).not.toThrow()
  })

  test("renders plain text without any special wrappers beyond paragraph", () => {
    const html = render("plain text")
    expect(html).toContain("plain text")
    // Should not have heading, list, etc.
    expect(html).not.toContain("<h1")
    expect(html).not.toContain("<ul")
  })

  test("renders multiple calls independently (no key counter leak)", () => {
    const html1 = render("# First")
    const html2 = render("# Second")
    expect(html1).toContain("First")
    expect(html2).toContain("Second")
    // Both should render correctly regardless of order
    expect(html1).toContain("<h1")
    expect(html2).toContain("<h1")
  })
})
