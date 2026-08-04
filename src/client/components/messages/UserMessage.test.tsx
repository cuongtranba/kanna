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

describe("UserMessage bubble", () => {
  test("renders the message body", () => {
    expect(render("hello there")).toContain("hello there")
  })

  test("is right-aligned and width-capped rather than full-bleed", () => {
    const html = render("hi")
    expect(html).toContain("items-end")
    expect(html).toContain("max-w-[85%]")
  })

  // The clipped top-right corner reads as a speech tail without drawing one,
  // and it is the only thing distinguishing the bubble's orientation now that
  // there is no avatar or name label.
  test("clips its top-right corner against the otherwise round bubble", () => {
    const html = render("hi")
    expect(html).toContain("rounded-[20px]")
    expect(html).toContain("rounded-tr-sm")
  })

  test("uses token surfaces, never a literal colour", () => {
    const html = render("hi")
    expect(html).toContain("bg-muted")
    expect(html).toContain("border-border")
  })
})
