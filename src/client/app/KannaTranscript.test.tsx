import { describe, expect, test } from "bun:test"
import { renderToStaticMarkup } from "react-dom/server"
import type { HydratedTranscriptMessage } from "../../shared/types"
import { KannaTranscript } from "./KannaTranscript"

const ROW_WRAPPER_CLASS = "mx-auto max-w-[800px] pb-5"

function renderTranscript(messages: HydratedTranscriptMessage[]) {
  return renderToStaticMarkup(
    <KannaTranscript
      messages={messages}
      isLoading={false}
      latestToolIds={{ AskUserQuestion: null, ExitPlanMode: null, TodoWrite: null }}
      onOpenLocalLink={() => undefined}
      onAskUserQuestionSubmit={() => undefined}
      onExitPlanModeConfirm={() => undefined}
    />
  )
}

function countRowWrappers(html: string) {
  return html.split(ROW_WRAPPER_CLASS).length - 1
}

describe("KannaTranscript", () => {
  test("renders user attachment cards outside the user bubble", () => {
    const html = renderTranscript([
      {
        id: "user-1",
        kind: "user_prompt",
        content: "What are these files about?",
        attachments: [{
          id: "file-1",
          kind: "file",
          displayName: "spec.pdf",
          absolutePath: "/tmp/project/.kanna/uploads/spec.pdf",
          relativePath: "./.kanna/uploads/spec.pdf",
          contentUrl: "/api/projects/project-1/uploads/spec.pdf/content",
          mimeType: "application/pdf",
          size: 1234,
        }],
        timestamp: new Date().toISOString(),
      },
    ])

    expect(html).toContain("spec.pdf")
    expect(html).toContain("application/pdf")
    expect(html).toContain("What are these files about?")
  })

  test("renders uploaded image attachments using the server content URL", () => {
    const html = renderTranscript([
      {
        id: "user-2",
        kind: "user_prompt",
        content: "",
        attachments: [{
          id: "image-1",
          kind: "image",
          displayName: "mock.png",
          absolutePath: "/tmp/project/.kanna/uploads/mock.png",
          relativePath: "./.kanna/uploads/mock.png",
          contentUrl: "/api/projects/project-1/uploads/mock.png/content",
          mimeType: "image/png",
          size: 512,
        }],
        timestamp: new Date().toISOString(),
      },
    ])

    expect(html).toContain("/api/projects/project-1/uploads/mock.png/content")
    expect(html).toContain("mock.png")
    expect(html).toContain("max-h-[300px]")
    expect(html).toContain("min-w-[200px]")
  })

  test("renders images before file attachments and user text", () => {
    const html = renderTranscript([
      {
        id: "user-3",
        kind: "user_prompt",
        content: "Please review these.",
        attachments: [
          {
            id: "image-2",
            kind: "image",
            displayName: "mock.png",
            absolutePath: "/tmp/project/.kanna/uploads/mock.png",
            relativePath: "./.kanna/uploads/mock.png",
            contentUrl: "/api/projects/project-1/uploads/mock.png/content",
            mimeType: "image/png",
            size: 512,
          },
          {
            id: "file-2",
            kind: "file",
            displayName: "spec.pdf",
            absolutePath: "/tmp/project/.kanna/uploads/spec.pdf",
            relativePath: "./.kanna/uploads/spec.pdf",
            contentUrl: "/api/projects/project-1/uploads/spec.pdf/content",
            mimeType: "application/pdf",
            size: 1234,
          },
        ],
        timestamp: new Date().toISOString(),
      },
    ])

    expect(html).toContain("justify-end gap-3")
    expect(html).toContain("justify-end gap-2")
    expect(html).toContain("Please review these.")
  })

  test("does not render wrappers for context window updates", () => {
    const html = renderTranscript([
      {
        id: "context-window-1",
        kind: "context_window_updated",
        usage: { usedTokens: 100, maxTokens: 1000, compactsAutomatically: false },
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(0)
  })

  test("renders only the final status row", () => {
    const html = renderTranscript([
      {
        id: "status-1",
        kind: "status",
        status: "working",
        timestamp: new Date().toISOString(),
      },
      {
        id: "status-2",
        kind: "status",
        status: "done",
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(1)
    expect(html).toContain("done")
    expect(html).not.toContain("working")
  })

  test("does not render a wrapper for results hidden by context cleared", () => {
    const html = renderTranscript([
      {
        id: "result-1",
        kind: "result",
        success: true,
        result: "Completed",
        durationMs: 100,
        timestamp: new Date().toISOString(),
      },
      {
        id: "context-cleared-1",
        kind: "context_cleared",
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(1)
    expect(html).toContain("Context Cleared")
    expect(html).not.toContain("Completed")
  })

  test("does not render wrappers for short successful result rows", () => {
    const html = renderTranscript([
      {
        id: "result-short-1",
        kind: "result",
        success: true,
        cancelled: false,
        result: "Hey! 👋",
        durationMs: 2562,
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(0)
  })

  test("renders wrappers for long successful result rows", () => {
    const html = renderTranscript([
      {
        id: "result-long-1",
        kind: "result",
        success: true,
        cancelled: false,
        result: "Done",
        durationMs: 61000,
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(1)
  })

  test("does not render wrappers for duplicate system and account rows", () => {
    const html = renderTranscript([
      {
        id: "system-1",
        kind: "system_init",
        provider: "codex",
        model: "gpt-5",
        tools: [],
        agents: [],
        slashCommands: [],
        mcpServers: [],
        timestamp: new Date().toISOString(),
      },
      {
        id: "system-2",
        kind: "system_init",
        provider: "codex",
        model: "gpt-5",
        tools: [],
        agents: [],
        slashCommands: [],
        mcpServers: [],
        timestamp: new Date().toISOString(),
      },
      {
        id: "account-1",
        kind: "account_info",
        accountInfo: { email: "a@example.com", subscriptionType: "Pro" },
        timestamp: new Date().toISOString(),
      },
      {
        id: "account-2",
        kind: "account_info",
        accountInfo: { email: "a@example.com", subscriptionType: "Pro" },
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(2)
  })

  test("renders one wrapper for visible transcript rows", () => {
    const html = renderTranscript([
      {
        id: "assistant-1",
        kind: "assistant_text",
        text: "Visible text",
        timestamp: new Date().toISOString(),
      },
    ])

    expect(countRowWrappers(html)).toBe(1)
    expect(html).toContain("Visible text")
  })
})
