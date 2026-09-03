import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import { UserMessage } from "./UserMessage"
import { UserMessageStore } from "./UserMessage.store"

function render(content: string) {
  return renderToStaticMarkup(
    <UserMessageStore.Provider init={undefined}>
      <UserMessage content={content} />
    </UserMessageStore.Provider>,
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

  test("carries no box, radius, or fill", () => {
    const html = render("hi")
    expect(html).not.toContain("rounded-[20px]")
    expect(html).not.toContain("rounded-tr-sm")
    expect(html).not.toContain("bg-muted")
  })

  test("names the speaker in the margin, and hides that gloss from screen readers", () => {
    // The label is decoration for the eye: the transcript already exposes
    // authorship structurally, so announcing "You" before every prompt is noise.
    const html = render("hi")
    expect(html).toContain(">You<")
    expect(html).toContain('aria-hidden="true"')
  })

  test("stacks the speaker above the text on a narrow measure", () => {
    // A fixed 48px gutter is a large fraction of a 390px viewport.
    const html = render("hi")
    expect(html).toContain("flex-col")
    expect(html).toContain("sm:flex-row")
  })

  test("uses token colours, never a literal one", () => {
    const html = render("hi")
    expect(html).toContain("text-foreground")
    expect(html).not.toMatch(/#[0-9a-fA-F]{6}/)
  })
})
