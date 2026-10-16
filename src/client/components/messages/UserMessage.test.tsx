import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { CommandOrigin } from "../../../shared/command-origin"
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
    const html = render("hi")
    expect(html).toContain("items-start")
    expect(html).not.toContain("items-end")
  })

  test("makes the speaker gloss immediately scannable", () => {
    const html = render("hi")

    expect(html).toContain("text-15")
    expect(html).toContain("font-semibold")
    expect(html).toContain("text-foreground")
  })

  test("carries a left-border accent to anchor the prompt on the rail", () => {
    const html = render("hi")
    expect(html).toContain("border-l-2")
    expect(html).toContain("border-foreground/25")
    expect(html).toContain("pl-3")
  })

  test("exposes a data-user-prompt marker for navigation", () => {
    const html = render("hi")
    expect(html).toContain('data-user-prompt="true"')
  })

  test("carries no box, radius, or fill", () => {
    const html = render("hi")
    expect(html).not.toMatch(/\brounded-/)
    expect(html).not.toMatch(/\bbg-/)
    expect(html).not.toMatch(/\bshadow/)
  })

  test("names the speaker in the margin, and hides that gloss from screen readers", () => {
    const html = render("hi")
    expect(html).toContain(">You<")
    expect(html).toContain('aria-hidden="true"')
  })

  test("stacks the speaker above the text, so the prompt starts on the rail", () => {
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

describe("UserMessage expanded command", () => {
  function renderExpanded(kind: "skill" | "command") {
    return renderToStaticMarkup(
      <ThemeProvider>
        <UserMessageStore.Provider init={undefined}>
          <UserMessage content="/kanna-test src" expandedCommand={{ name: "kanna-test", kind }} />
        </UserMessageStore.Provider>
      </ThemeProvider>,
    )
  }

  test("keeps the typed line as the body", () => {
    expect(renderExpanded("skill")).toContain("/kanna-test src")
  })

  test("names what ran, and whether it was a skill or a command", () => {
    expect(renderExpanded("skill")).toContain("skill")
    expect(renderExpanded("command")).toContain("command")
    expect(renderExpanded("skill")).toContain("kanna-test")
  })

  test("reads as muted metadata rather than a coloured badge", () => {
    const html = renderExpanded("skill")
    expect(html).toContain("text-muted-foreground")
    expect(html).not.toMatch(/text-(warning|info|success|destructive)\b/)
  })

  test("says nothing when nothing was expanded", () => {
    const html = renderToStaticMarkup(
      <ThemeProvider>
        <UserMessageStore.Provider init={undefined}>
          <UserMessage content="plain message" />
        </UserMessageStore.Provider>
      </ThemeProvider>,
    )
    expect(html).not.toContain("ran the")
  })
})

describe("UserMessage origin", () => {
  function renderOrigin(origin?: CommandOrigin) {
    return renderToStaticMarkup(
      <ThemeProvider>
        <UserMessageStore.Provider init={undefined}>
          <UserMessage content="start the build" origin={origin} />
        </UserMessageStore.Provider>
      </ThemeProvider>,
    )
  }

  test("labels a message that arrived over MCP with the client that sent it", () => {
    const html = renderOrigin({ kind: "remote_mcp", clientId: "client-1", clientName: "ChatGPT", via: "oauth", tool: "send_message", callId: "call-1" })
    expect(html).toContain("via MCP · ChatGPT")
    expect(html).toContain("text-muted-foreground")
  })

  test("falls back to the client id when the client sent no name", () => {
    const html = renderOrigin({ kind: "remote_mcp", clientId: "password", via: "password", tool: "send_message", callId: "call-1" })
    expect(html).toContain("via MCP · password")
  })

  test("says nothing about the source of a message typed in the app", () => {
    expect(renderOrigin()).not.toContain("via MCP")
  })
})
