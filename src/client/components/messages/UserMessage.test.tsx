import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { ThemeProvider } from "../../hooks/useTheme"
import { UserMessage } from "./UserMessage"
import { UserMessageStore } from "./UserMessage.store"

function render(content: string) {
  return renderToStaticMarkup(
    <ThemeProvider>
      <UserMessageStore.Provider init={undefined}>
        <UserMessage content={content} />
      </UserMessageStore.Provider>
    </ThemeProvider>,
  )
}

describe("UserMessage plate", () => {
  test("renders the message body", () => {
    expect(render("hello there")).toContain("hello there")
  })

  test("sits on the rail rather than in a right-aligned bubble", () => {
    // The bubble was the last card on this surface: its own box, radius, fill
    // and alignment meant the user's own words were the one thing not measured
    // from the rail everything else hangs off.
    const html = render("hi")
    expect(html).toContain("items-start")
    expect(html).not.toContain("items-end")
  })

  test("makes the speaker gloss immediately scannable without adding a second rule", () => {
    const html = render("hi")

    expect(html).toContain("text-15")
    expect(html).toContain("font-semibold")
    expect(html).toContain("text-foreground")
    expect(html).not.toContain("border-l")
    expect(html).not.toContain("pl-")
  })

  test("carries no box, radius, or fill", () => {
    const html = render("hi")
    expect(html).not.toMatch(/\brounded-/)
    expect(html).not.toMatch(/\bbg-/)
    expect(html).not.toMatch(/\bshadow/)
  })

  test("names the speaker in the margin, and hides that gloss from screen readers", () => {
    // The label is decoration for the eye: the transcript already exposes
    // authorship structurally, so announcing "You" before every prompt is noise.
    const html = render("hi")
    expect(html).toContain(">You<")
    expect(html).toContain('aria-hidden="true"')
  })

  test("stacks the speaker above the text, so the prompt starts on the rail", () => {
    // Spending a 48px gutter plus a gap on the gloss inside the measure would
    // push the prompt far off the transcript's reading rail.
    const html = render("hi")
    expect(html).toContain("flex-col")
    expect(html).not.toContain("sm:flex-row")
    expect(html).not.toContain("sm:w-12")
  })

  test("uses token colours, never a literal one", () => {
    const html = render("hi")
    expect(html).toContain("text-foreground")
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
  })

  test("keeps links, inline code, and code blocks readable inside the prompt", () => {
    const html = render("Read [the guide](https://example.com) and run `bun test`.\n\n```ts\nconst ready = true\n```")

    expect(html).toContain('href="https://example.com"')
    expect(html).toContain("<code")
    expect(html).toContain("<pre")
    expect(html).toContain("const ready = true")
  })
})
